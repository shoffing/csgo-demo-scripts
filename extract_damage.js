const demofile = require('demofile');
const fs = require('fs');
const _ = require('lodash');
const { fromEvent, forkJoin } = require('rxjs');
const { map, tap, first } = require('rxjs/operators');

// Find demo files to read
const INFERNO_DEMOS = fs.readdirSync('demos')
    .filter(fileName => fileName.endsWith('.dem'))
    .map(fileName => `./demos/${fileName}`);

/* ***** */

let distance3 = (p1, p2) => {
    return Math.sqrt( Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2) + Math.pow(p2.z - p1.z, 2) );
};

const parsers$ = INFERNO_DEMOS.map(DEMO_FILE => {
    let attacks = [];
    let plants = [];

    let demo = new demofile.DemoFile();

    let getTeam = (player) => {
        if (_.includes(demo.teams[demofile.TEAM_CTS].members.map(p => p.userId), player.userId)) {
            return "CT";
        }
        return "T";
    };

    // Wait for the first round, we don't care about the warm-up.
    let gameStarted = false;
    demo.gameEvents.on("round_start", e => {
        console.log(`=== ROUND #${demo.gameRules.roundsPlayed} STARTED IN ${DEMO_FILE} ===`);
        gameStarted = true;
    });

    // Record bomb plant position and information
    demo.gameEvents.on("bomb_planted", e => {
        if (gameStarted) {
            console.log(`!! BOMB PLANTED IN ${DEMO_FILE}`);
            const planter = demo.entities.getByUserId(e.userid);
            plants.push({
                time: demo.currentTime,
                round: demo.gameRules.roundsPlayed,
                pos: planter.position,
                name: planter.name,
                score: {
                    T: demo.teams[demofile.TEAM_TERRORISTS].score,
                    CT: demo.teams[demofile.TEAM_CTS].score,
                },
            });
        }
    });

    demo.userMessages.on("message", e => {
        if (gameStarted && e.name === 'CS_UM_Damage') {
            const victim = _.find(demo.players, p => p.index === e.msg.victimEntindex);
            // It's not perfect, but we can find the attacker with reasonable accuracy by finding the closest player to inflictorWorldPos.
            const attacker = _.minBy(demo.players, p => {
                return distance3(p.position, e.msg.inflictorWorldPos);
            });
            if (victim && attacker && victim.index !== attacker.index
                && attacker.isAlive && distance3(attacker.position, e.msg.inflictorWorldPos) < 50) {
                const victimTeam = getTeam(victim);
                const attackerTeam = getTeam(attacker);
                const amount = e.msg.amount;
                const weapon = attacker.weapon.className;
                // console.log(`${attacker.name} (${attackerTeam}) attacked ${victim.name} (${victimTeam}) for ${amount} damage with ${weapon}`);
                attacks.push({
                    time: demo.currentTime,
                    round: demo.gameRules.roundsPlayed,
                    score: {
                        T: demo.teams[demofile.TEAM_TERRORISTS].score,
                        CT: demo.teams[demofile.TEAM_CTS].score,
                    },
                    attacker: {
                        pos: attacker.position,
                        team: attackerTeam,
                        name: attacker.name,
                    },
                    victim: {
                        pos: victim.position,
                        team: victimTeam,
                        name: victim.name,
                    },
                    amount: amount,
                    weapon: weapon,
                });
            }
        }
    });

    demo.parse(fs.readFileSync(DEMO_FILE));
    return fromEvent(demo, 'end').pipe(
        tap(e => console.log(`=== DEMO FINISHED PARSING ${DEMO_FILE} ===`)),
        map(e => e.error ? e : { attacks, plants }),
        first()
    );
});

forkJoin(parsers$).subscribe(
    results => {
        const data = results.reduce((result, parsed) => {
            if (parsed.error) {
                console.error(parsed.error);
                return result;
            } else {
                return {
                    attacks: result.attacks.concat(parsed.attacks),
                    plants: result.plants.concat(parsed.plants),
                };
            }
        }, { attacks: [], plants: [] });

        const OUTPUT_FILE = 'inferno_damage.json';
        fs.writeFile(OUTPUT_FILE, JSON.stringify(data), 'utf8', (err) => {
            if (err) throw err;
            console.log(`=== Wrote ${data.attacks.length} attacks and ${data.plants.length} plants to ${OUTPUT_FILE} ===`);
        });
    },
    error => console.log(error),
    () => console.log('Damages extracted.'),
);