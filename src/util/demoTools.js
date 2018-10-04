const demofile = require('demofile');
const _ = require('lodash');

module.exports.getTeam = (demo, player) => {
    if (!player || !player.userInfo) return undefined;
    if (_.includes(demo.teams[demofile.TEAM_CTS].members.map(p => p && p.userInfo && p.userInfo.userId), player.userId)) {
        return "CT";
    } else if (_.includes(demo.teams[demofile.TEAM_TERRORISTS].members.map(p => p && p.userInfo && p.userInfo.userId), player.userId)) {
        return "T";
    }
};