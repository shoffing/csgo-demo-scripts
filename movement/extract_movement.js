const demofile = require('demofile');
const fs = require('fs');
const _ = require('lodash');
const { fromEvent, forkJoin } = require('rxjs');
const { map, filter, tap, first } = require('rxjs/operators');

const DEMOS_DIR = '../demos';
const TICKS_PER_POS = 16;

const OUTPUT_FILE = 'all_inferno_movement.json';

// Find demo files to read
const GAME_DEMOS = fs.readdirSync(DEMOS_DIR)
    .filter(fileName => fileName.endsWith('.dem'))
    .map(fileName => `${DEMOS_DIR}/${fileName}`);


/* ***** */

let distance3 = (p1, p2) => {
    return Math.sqrt( Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2) + Math.pow(p2.z - p1.z, 2) );
};

const parsers$ = GAME_DEMOS.map(DEMO_FILE => {
    let playerPositions = {};

    let demo = new demofile.DemoFile();

    let getTeam = (player) => {
        if (_.includes(demo.teams[demofile.TEAM_CTS].members.map(p => p && p.userId), player.userId)) {
            return "CT";
        }
        return "T";
    };

    // Wait for the first round, we don't care about the warm-up.
    let gameStarted = false;
    let lastRoundNumber = -1;
    demo.gameEvents.on("round_start", e => {
        if (demo.gameRules.roundsPlayed > lastRoundNumber) {
            console.log(`=== ROUND #${demo.gameRules.roundsPlayed} STARTED IN ${DEMO_FILE} ===`);
            demo.players
                .filter(player => player.isAlive)
                .forEach(player => {
                    if (gameStarted) {
                        playerPositions[player.name].push([]);
                    } else {
                        playerPositions[player.name] = [[]];
                    }
                });
            lastRoundNumber = demo.gameRules.roundsPlayed;
        }
        gameStarted = true;
    });

    fromEvent(demo, 'tickend')
        .pipe(filter(tick => gameStarted && (tick % TICKS_PER_POS === 0)))
        .subscribe(() => {
            demo.players
                .filter(player => player.isAlive)
                .forEach(player => {
                    const currentPlayerLife = _.last(playerPositions[player.name]);
                    const lastPos = _.last(currentPlayerLife);
                    let lastDistance = lastPos && distance3(player.position, lastPos.pos);
                    if (!lastPos || (lastDistance > 0 && lastDistance < 100)) {
                        currentPlayerLife.push({
                            pos: player.position,
                            team: getTeam(player),
                            health: player.health,
                        });
                    }
                });
        });

    demo.parse(fs.readFileSync(DEMO_FILE));
    return fromEvent(demo, 'end').pipe(
        tap(e => console.log(`=== DEMO FINISHED PARSING ${DEMO_FILE} ===`)),
        map(e => e.error ? e : playerPositions),
        first()
    );
});

forkJoin(parsers$).subscribe(
    results => {
        let output = {};
        results.forEach(movementJson => {
            for (let player in movementJson) {
                if (output[player]) {
                    output[player] = output[player].concat(movementJson[player]);
                } else {
                    output[player] = movementJson[player];
                }
            }
        });

        fs.writeFile(OUTPUT_FILE, JSON.stringify(output), 'utf8', (err) => {
            if (err) throw err;
            console.log(`=== Wrote movement to ${OUTPUT_FILE} ===`);
        });
    },
    error => console.log(error),
    () => console.log('Movement extracted.'),
);