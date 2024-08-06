'use strict';

const SubstrateConnector = require('./substrateConnector');


async function connectorFactory(workerIndex) {
    return new SubstrateConnector(workerIndex, 'substrate');
}

module.exports.ConnectorFactory = connectorFactory;
