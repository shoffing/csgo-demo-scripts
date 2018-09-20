const fs = require('fs');
const _ = require('lodash');
const D3Node = require('d3-node');

const DAMAGE_DEALT_FILE = 'inferno_damage.json';
const DAMAGE_ALPHA_SCALE = 0.8;

// Scaling world coordinates to image coordinates
const remapCoords = [
    [[2404, -182], [1834, 1654]],
    [[246.5, 3085.5], [952, 318]]
];
let mapWorldToImage = (pos) => {
    return {
        x: (remapCoords[1][1][0] - remapCoords[0][1][0]) * (pos.x - remapCoords[0][0][0]) / (remapCoords[1][0][0] - remapCoords[0][0][0]) + remapCoords[0][1][0],
        y: (remapCoords[1][1][1] - remapCoords[0][1][1]) * (pos.y - remapCoords[0][0][1]) / (remapCoords[1][0][1] - remapCoords[0][0][1]) + remapCoords[0][1][1]
    };
};

const SVG_FILE_NAME = "inferno_damage_dealt.svg";

const data = JSON.parse(fs.readFileSync(DAMAGE_DEALT_FILE));
const attacks = data.attacks; // can use .filter() here

const maxDamage = _.max(attacks.map(a => a.amount));

const d3n = new D3Node();
const svg = d3n.createSVG(2048, 2048);

svg.append("rect")
    .attr("width", 2048)
    .attr("height", 2048)
    .attr("fill", "black");

svg.append("image")
    .attr("xlink:href", fs.readFileSync('inferno_base64'))
    .attr("width", 2048)
    .attr("height", 2048)
    .attr("opacity", 0.3);


attacks.forEach(a => {
    const alpha = (1 - DAMAGE_ALPHA_SCALE) + DAMAGE_ALPHA_SCALE * (a.amount / maxDamage);
    const color = a.attacker.team === 'T' ? `rgba(237,163,56,${alpha})` : `rgba(104,163,229,${alpha})`;

    const attackerPos = mapWorldToImage(a.attacker.pos);
    const victimPos = mapWorldToImage(a.victim.pos);

    svg.append("line")
        .attr("x1", attackerPos.x)
        .attr("y1", attackerPos.y)
        .attr("x2", victimPos.x)
        .attr("y2", victimPos.y)
        .attr("stroke", color)
        .attr("stroke-width", 1);
    svg.append("circle")
        .attr("cx", attackerPos.x)
        .attr("cy", attackerPos.y)
        .attr("r", 2)
        .attr("stroke", color)
        .attr("fill", "rgba(0,0,0,0)");
});

fs.writeFileSync(SVG_FILE_NAME, d3n.svgString());