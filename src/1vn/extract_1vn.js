const demofile = require('demofile');
const fs = require('fs');
const _ = require('lodash');
const { fromEvent, forkJoin, of } = require('rxjs');
const rxop = require('rxjs/operators');
const { getFiles } = require('../util/getFiles');
const { getTeam } = require('../util/demoTools');

const BATCH_SIZE = 8;

const DEMOS_DIR = `../../demos`;
const demoFilter = (f) =>
    !_.startsWith(_.last(f.split('/')), '._') && _.endsWith(f, '.dem');

const OUTPUT_FILE = 'one_vs_ns.json';
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
            rxop.concatMap(UNPARSED_DEMOS_BATCH => {
                startTime = new Date();

                const parsers = UNPARSED_DEMOS_BATCH.map(DEMO_FILE => {
                    const demo = new demofile.DemoFile();

                    const gameStarts$ = fromEvent(demo.gameEvents, 'round_start').pipe(
                        rxop.first(),
                        rxop.tap(() => console.log(`GAME STARTED ${DEMO_FILE}`)),
                    );
                    const gameEnds$ = fromEvent(demo, 'end').pipe(
                        rxop.first(),
                        rxop.tap(() => console.log(`GAME ENDED ${DEMO_FILE}`)),
                    );

                    const roundEnds$ = fromEvent(demo.gameEvents, 'round_end');

                    const get1vN = (rsh) => {
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

                        const lastState = _.last(roundStateHistory);

                        const comebackT = (!lastState.CT && _.find(roundStateHistory, sh => ts(sh) === 1 && cts(sh) > 1));
                        const comebackCT = (!lastState.T && _.find(roundStateHistory, sh => cts(sh) === 1 && ts(sh) > 1));
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
                                // todo: why does this happen?
                                console.error(`BAD COMEBACK DETECTED IN ${DEMO_FILE} round ${demo.gameRules.roundsPlayed} :: ${JSON.stringify(comeback)} :: ${JSON.stringify(rsh)}`);
                                return undefined;
                            }
                        }

                        return (comeback && {
                            type: `1v${Math.max(ts(comeback), cts(comeback))}`,
                            player: {...comeback[team][0], team},
                            time: lastState.time - roundStateHistory[_.findIndex(roundStateHistory, comeback) + 1].time,
                        }) || undefined;
                    };

                    const oneVersusNs$ = fromEvent(demo.gameEvents, 'player_death').pipe(
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
                        rxop.mergeMap(roundStateHistory => {
                            const oneVersusN = get1vN(roundStateHistory);
                            if (oneVersusN) {
                                return [{
                                    type: oneVersusN.type,
                                    player: oneVersusN.player,
                                    time: oneVersusN.time,
                                    round: demo.gameRules.roundsPlayed,
                                    event: DEMO_FILE.split('/demos/')[1].split('/')[0],
                                    demoFile: DEMO_FILE.split('/demos/')[1],
                                }];
                            }
                            return [];
                        }),
                        rxop.tap(console.log),
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
                        UNPARSED_DEMOS_BATCH
                    })),
                );
            }),
        ).subscribe(
            batchResult => {
                const {results, UNPARSED_DEMOS_BATCH} = batchResult;

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
                console.log(`=== BATCH [${BATCH_SIZE}] COMPLETED IN ${execTime} SECONDS ===\n\n`);
            },
            error => console.log(error),
            () => console.log('Done.'),
        );
    });