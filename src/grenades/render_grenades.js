const fs = require('fs');
const _ = require('lodash');
const D3Node = require('d3-node');

const INPUT_JSON = 'inferno_grenades.json';
const OUTPUT_SVG = (type) => `inferno_grenades_${type}.svg`;

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


const grenades = JSON.parse(fs.readFileSync(INPUT_JSON));
const grenadeFilter = g => true;

for (let grenadeType in grenades) {
    const d3n = new D3Node();
    const svg = d3n.createSVG(2048, 2048);

    svg.append("rect")
        .attr("width", 2048)
        .attr("height", 2048)
        .attr("fill", "black");

    svg.append("image")
        .attr("xlink:href", fs.readFileSync('../resources/inferno_base64'))
        .attr("width", 2048)
        .attr("height", 2048)
        .attr("opacity", 0.3);

    grenades[grenadeType].filter(grenadeFilter).forEach(g => {
        const color = g.team === 'T' ? `rgb(237,163,56)` : `rgba(104,163,229)`;

        let pos = mapWorldToImage(g.pos);

        svg.append("circle")
            .attr("cx", pos.x)
            .attr("cy", pos.y)
            .attr("r", 6)
            .attr("stroke", color)
            .attr("fill", 'transparent');
    });

    fs.writeFileSync(OUTPUT_SVG(grenadeType), d3n.svgString());
}
