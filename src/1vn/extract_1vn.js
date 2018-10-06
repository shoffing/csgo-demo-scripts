const demofile = require('demofile');
const fs = require('fs');
const _ = require('lodash');
const { fromEvent, forkJoin, of, merge } = require('rxjs');
const rxop = require('rxjs/operators');
const { getFiles } = require('../util/getFiles');
const { getTeam } = require('../util/demoTools');

// Clutching player must be alone and alive for at least 5 seconds
const MIN_TIME_ALIVE = 5;

const BATCH_SIZE = 4;
let BATCH_PROCESS_TIMES = [];

const DEMOS_DIR = `../../demos`;
const demoFilter = (f) =>
    !_.startsWith(_.last(f.split('/')), '._') && _.endsWith(f, '.dem');

const OUTPUT_FILE = '_one_vs_ns.json';
const PARSED_DEMOS_LIST_FILE = '_parsed.json';

// Find demo files to read
getFiles(DEMOS_DIR, demoFilter)
    .catch(e => console.error(e))
    .then(DEMOS => {
        let UNPARSED_DEMOS = DEMOS;
        let PARSED_DEMOS = [];
        if (fs.existsSync(PARSED_DEMOS_LIST_FILE)) {
            PARSED_DEMOS = JSON.parse(fs.readFileSync(PARSED_DEMOS_LIST_FILE));
            UNPARSED_DEMOS = UNPARSED_DEMOS.filter(demo => !_.includes(PARSED_DEMOS.map(d => d.demo), demo));
        }
        let startTime;
        of(... _.chunk(UNPARSED_DEMOS, BATCH_SIZE)).pipe(
            rxop.concatMap((UNPARSED_DEMOS_BATCH, demoBatchIdx) => {
                startTime = new Date();

                const parsers = UNPARSED_DEMOS_BATCH.map(DEMO_FILE => {
                    const demo = new demofile.DemoFile();

                    const gameStarts$ = fromEvent(demo.gameEvents, 'round_start').pipe(
                        rxop.first(),
                    );
                    const gameEnds$ = fromEvent(demo, 'end').pipe(
                        rxop.first(),
                    );

                    // Some demos have round_end not round_officially_ended. Some are the other way around.
                    // So we'll use both and do the best we can with that.
                    let lastRoundScore = {};
                    const roundEndsWinner$ = fromEvent(demo.gameEvents, 'round_end').pipe(
                        rxop.filter(e => (e.winner === demofile.TEAM_TERRORISTS || e.winner === demofile.TEAM_CTS) && e.reason < 11),
                        rxop.map(e => {
                            if (e.winner === demofile.TEAM_TERRORISTS) return {winner: 'T'};
                            else if (e.winner === demofile.TEAM_CTS) return {winner: 'CT'};
                        }),
                    );

                    const roundEndsOfficiallyWinner$ = fromEvent(demo.gameEvents, 'round_officially_ended').pipe(
                        rxop.map(() => {
                            let tScore = demo.teams[demofile.TEAM_TERRORISTS].score;
                            let ctScore = demo.teams[demofile.TEAM_CTS].score;
                            let lastTScore = lastRoundScore[demo.teams[demofile.TEAM_TERRORISTS].clanName] || 0;
                            let lastCTScore = lastRoundScore[demo.teams[demofile.TEAM_CTS].clanName] || 0;
                            let winner = tScore > lastTScore ? 'T' : (ctScore > lastCTScore ? 'CT' : undefined);

                            lastRoundScore = {};
                            lastRoundScore[demo.teams[demofile.TEAM_TERRORISTS].clanName] = tScore;
                            lastRoundScore[demo.teams[demofile.TEAM_CTS].clanName] = ctScore;

                            return {winner};
                        }),
                    );

                    const roundEnds$ = merge(roundEndsWinner$, roundEndsOfficiallyWinner$);

                    const get1vN = (rsh, winner) => {
                        const ts = sh => (sh && sh.T && sh.T.length) || 0;
                        const cts = sh => (sh && sh.CT && sh.CT.length) || 0;

                        // Clean up round state history:
                        // Number of players alive in a round should never go up
                        // The first entry in the state history should have 9 players (after one dies)
                        const badStatePair = shPair => ts(shPair[1]) > ts(shPair[0]) || cts(shPair[1]) > cts(shPair[0]);
                        const roundStateHistory = _.dropRightWhile(
                            _.dropWhile(_.zip(rsh, _.tail(rsh)), sh => (ts(sh[0]) + cts(sh[0]) !== 9) || badStatePair(sh)),
                            badStatePair
                        ).map(shPair => shPair[0]);
                        if (roundStateHistory.length === 0) return undefined;

                        const comebackT = (winner === 'T' && _.find(roundStateHistory, sh => ts(sh) === 1 && cts(sh) > 1));
                        const comebackCT = (winner === 'CT' && _.find(roundStateHistory, sh => cts(sh) === 1 && ts(sh) > 1));
                        const comeback = comebackT || comebackCT;
                        const team = comebackT ? 'T' : 'CT';

                        if (comeback) {
                            // Double check that the history is clean
                            const comebackIdx = _.findIndex(roundStateHistory, comeback);
                            const comebackStates = _.drop(roundStateHistory, comebackIdx);
                            const cleanComeback = _.every(
                                _.zip(comebackStates, _.tail(comebackStates)),
                                shPair => !badStatePair(shPair),
                            );
                            if (!cleanComeback) {
                                // something is wrong with the demofile.
                                // probably caused by round_officially_ended not firing
                                console.error(`BAD COMEBACK DETECTED IN ${DEMO_FILE} round ${demo.gameRules.roundsPlayed} :: ${JSON.stringify(comeback)} :: ${JSON.stringify(rsh)}`);
                                return undefined;
                            }
                        } else return undefined;

                        let lastState = _.last(roundStateHistory);

                        // Check if clutcher dies in under MIN_TIME_ALIVE
                        let stateWhereClutcherDies = _.find(roundStateHistory, sh => !sh[team]);
                        if (stateWhereClutcherDies && stateWhereClutcherDies.time - comeback.time < MIN_TIME_ALIVE) {
                            return undefined;
                        }

                        const healthStart = comeback[team][0].health;
                        const healthEnd = lastState[team] ? lastState[team][0].health : 0;
                        return {
                            type: `1v${Math.max(ts(comeback), cts(comeback))}`,
                            player: _.omit({
                                ...comeback[team][0],
                                team,
                                healthStart,
                                healthEnd,
                            }, 'health'),
                        };
                    };

                    const playerDeaths$ = fromEvent(demo.gameEvents, 'player_death');
                    const oneVersusNs$ = merge(playerDeaths$, roundEnds$).pipe(
                        rxop.skipUntil(gameStarts$),
                        rxop.map(e => {
                            let roundState = _.mapValues(
                                _.groupBy(demo.players.filter(p => p.isAlive), p => getTeam(demo, p)),
                                team => team.map(p => ({
                                    name: p.userInfo && p.userInfo.name,
                                    health: p.health,
                                    fteEquipValue: p.freezeTimeEndEquipmentValue,
                                    equipValue: p.currentEquipmentValue,
                                }))
                            );
                            roundState.time = demo.currentTime;
                            return roundState;
                        }),
                        rxop.buffer(roundEnds$),
                        rxop.withLatestFrom(roundEnds$),
                        rxop.mergeMap(e => {
                            const [roundStateHistory, roundEnd] = e;
                            const winner = roundEnd.winner;
                            const oneVersusN = get1vN(roundStateHistory, winner);
                            if (oneVersusN) {
                                return [{
                                    type: oneVersusN.type,
                                    player: oneVersusN.player,
                                    round: demo.gameRules.roundsPlayed,
                                    event: DEMO_FILE.split('/demos/')[1].split('/')[0],
                                    demoFile: DEMO_FILE.split('/demos/')[1],
                                }];
                            }
                            return [];
                        }),
                        rxop.tap(clutch => console.log(JSON.stringify(clutch))),
                    );

                    console.log(`...parsing ${DEMO_FILE}...`);
                    demo.parse(fs.readFileSync(DEMO_FILE));

                    return oneVersusNs$.pipe(
                        rxop.takeUntil(gameEnds$),
                        rxop.reduce((acc, r) => acc.concat(r), []),
                        rxop.tap(() => demo.cancel()),
                        rxop.catchError((e) => console.error(e)),
                    );
                });
                return forkJoin(parsers).pipe(
                    rxop.map(results => ({
                        results,
                        UNPARSED_DEMOS_BATCH,
                        demoBatchIdx,
                    })),
                );
            }),
        ).subscribe(
            batchResult => {
                const {results, UNPARSED_DEMOS_BATCH, demoBatchIdx} = batchResult;

                let data = [];
                if (fs.existsSync(OUTPUT_FILE)) {
                    data = data.concat(JSON.parse(fs.readFileSync(OUTPUT_FILE)));
                }
                data = data.concat(_.flatten(results));
                data = _.uniqBy(data, ovn => ovn.round + ovn.event + ovn.demoFile);

                fs.writeFileSync(OUTPUT_FILE, JSON.stringify(data, null, 2));

                PARSED_DEMOS = [...PARSED_DEMOS, ...UNPARSED_DEMOS_BATCH.map(demo => ({
                    date: new Date(),
                    demo
                }))];
                fs.writeFileSync(PARSED_DEMOS_LIST_FILE, JSON.stringify(PARSED_DEMOS, null, 2));

                const execTime = (new Date() - startTime) / 1000.0;

                BATCH_PROCESS_TIMES.push(execTime);
                BATCH_PROCESS_TIMES = _.takeRight(BATCH_PROCESS_TIMES, 10);
                const avgTimePerDemo = _.mean(BATCH_PROCESS_TIMES) / BATCH_SIZE;
                const demosLeft = Math.max(UNPARSED_DEMOS.length - (demoBatchIdx + 1) * BATCH_SIZE, 0);
                const timeLeft = Number.parseFloat(demosLeft * avgTimePerDemo).toFixed(1);
                console.log(`=== Batch [${UNPARSED_DEMOS_BATCH.length}] completed in ${execTime} seconds ===`);
                console.log(`=== Currently averaging ${avgTimePerDemo} seconds per demo ===`);
                console.log(`=== Estimated time left (${demosLeft} demos): ${timeLeft} seconds ===\n\n`)
            },
            error => console.log(error),
            () => console.log('Done.'),
        );
    });