/*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
* http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/

'use strict';

const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
chai.use(chaiAsPromised);
chai.should();
const path = require('path');
const mockery = require('mockery');

const validConfig = './../sample-config/ValidNetworkConfig.json';
const invalidConfigNonWs = './../sample-config/InvalidNetworkConfigNonWs.json';
const invalidConfigNoURL= './../sample-config/InvalidNetworkConfigNoURL.json';

const { ConfigUtil } = require('@hyperledger/caliper-core');

const { WsProvider, ApiPromise, Keyring, BN, hash } = require('../stubs/Stubs.js');

describe('A Connector Configuration Factory', () => {
    let PolkadotConnector;

    before(() => {
        mockery.enable({
            warnOnReplace: false,
            warnOnUnregistered: false,
            useCleanCache: true
        });

        mockery.registerMock('@polkadot/api', {
            WsProvider,
            ApiPromise,
            Keyring
        });
        mockery.registerMock('@polkadot/api/package', { verison: '15.9.1' });

        mockery.registerMock('@polkadot/util', {
            BN
        });
        mockery.registerMock('@polkadot/util/package', { verison: '13.4.3' });

        PolkadotConnector = require('../../lib/polkadot-connector.js');
    });

    it('should reject non WS URL', async () => {
        ConfigUtil.set(ConfigUtil.keys.NetworkConfig, path.resolve(__dirname, invalidConfigNonWs));
        chai.expect(() => new PolkadotConnector(1, 'polkadot')).to.throw('URL needs to be a Websocket connection.');
    });

    it('should reject missing URL', async () => {
        ConfigUtil.set(ConfigUtil.keys.NetworkConfig, path.resolve(__dirname, invalidConfigNoURL));
        chai.expect(() => new PolkadotConnector(1, 'polkadot')).to.throw('No URL given to access the Polkadot SUT.');
    });

    it('should accept a valid network config', async () => {
        ConfigUtil.set(ConfigUtil.keys.NetworkConfig, path.resolve(__dirname, validConfig));
        new PolkadotConnector(1, 'polkadot');
    });

    it('should initialize properly', async () => {
        ConfigUtil.set(ConfigUtil.keys.NetworkConfig, path.resolve(__dirname, validConfig));
        const connector = new PolkadotConnector(1, 'polkadot');
        await connector.init().should.not.be.rejected;
    });

    it('should prepare worker args', async () => {
        ConfigUtil.set(ConfigUtil.keys.NetworkConfig, path.resolve(__dirname, validConfig));
        const connector = new PolkadotConnector(1, 'polkadot');
        const result = await connector.prepareWorkerArguments(2).should.not.be.rejected;
        chai.assert(result[0].key.uri === '//Alice');
        chai.assert(result[1].key.uri === '//Bob');
        chai.assert(result[2].key.uri === '//Charlie');
        chai.assert(result[0].key.type === 'sr25519');
        chai.assert(result[1].key.type === 'sr25519');
        chai.assert(result[2].key.type === 'ed25519');
    });

    it('should throw on incorrect number of seeds', async () => {
        ConfigUtil.set(ConfigUtil.keys.NetworkConfig, path.resolve(__dirname, validConfig));
        const connector = new PolkadotConnector(1, 'polkadot');
        // More workers than the supplied seeds
        await connector.prepareWorkerArguments(10).should.be.rejectedWith(/Not enough seeds provided/);
    });

    it('should return a valid context', async () => {
        ConfigUtil.set(ConfigUtil.keys.NetworkConfig, path.resolve(__dirname, validConfig));
        const connector = new PolkadotConnector(1, 'polkadot');
        const args = await connector.prepareWorkerArguments(1).should.not.be.rejected;
        const context1 = await connector.getContext(0, args[0]).should.not.be.rejected;
        const context2 = await connector.getContext(0, args[1]).should.not.be.rejected;
        chai.assert(context1.nonce.eq(new BN(1)));
        chai.assert(context2.nonce.eq(new BN(1)));

        // Addresses are mocked hashes of the seed
        chai.assert(context1.address === hash(context1.keyPair.seed));
        chai.assert(context2.address === hash(context2.keyPair.seed));

        // Different API connections for different workers
        chai.assert(context1.api !== context2.api);
    });

    it('should release context', async () => {
        ConfigUtil.set(ConfigUtil.keys.NetworkConfig, path.resolve(__dirname, validConfig));
        const connector = new PolkadotConnector(1, 'polkadot');
        const args = await connector.prepareWorkerArguments(1).should.not.be.rejected;
        const context = await connector.getContext(0, args[0]).should.not.be.rejected;

        chai.assert(context.api.connected);

        await connector.releaseContext();

        chai.assert(!context.api.connected);
    });

    it('should send a single successful request', async () => {
        ConfigUtil.set(ConfigUtil.keys.NetworkConfig, path.resolve(__dirname, validConfig));
        const connector = new PolkadotConnector(1, 'polkadot');
        const args = await connector.prepareWorkerArguments(1).should.not.be.rejected;
        await connector.getContext(0, args[0]).should.not.be.rejected;

        let tx = await connector._sendSingleRequest({
            pallet: 'balances',
            extrinsic: 'transferKeepAlive',
            args: ['ddee1e8626ddd07e85315eb83774f187', 2000]
        }).should.not.be.rejected;

        chai.assert(tx.status.status === 'success');
    });

    it('should fail invalid request', async () => {
        ConfigUtil.set(ConfigUtil.keys.NetworkConfig, path.resolve(__dirname, validConfig));
        const connector = new PolkadotConnector(1, 'polkadot');
        const args = await connector.prepareWorkerArguments(1).should.not.be.rejected;
        await connector.getContext(0, args[0]).should.not.be.rejected;

        // Amount is too low
        let tx = await connector._sendSingleRequest({
            pallet: 'balances',
            extrinsic: 'transferKeepAlive',
            args: ['ddee1e8626ddd07e85315eb83774f187', 1]
        }).should.not.be.rejected;

        chai.assert(tx.status.status === 'failed');
    });

    it('should fail non existing pallet and not change the nonce', async () => {
        ConfigUtil.set(ConfigUtil.keys.NetworkConfig, path.resolve(__dirname, validConfig));
        const connector = new PolkadotConnector(1, 'polkadot');
        const args = await connector.prepareWorkerArguments(1).should.not.be.rejected;
        const context = await connector.getContext(0, args[0]).should.not.be.rejected;
        chai.assert(context.nonce.eq(new BN(1)));

        // Pallet nothere
        let tx = await connector._sendSingleRequest({
            pallet: 'nothere',
            extrinsic: 'nothere',
            args: ['ddee1e8626ddd07e85315eb83774f187', 1]
        }).should.not.be.rejected;

        chai.assert(tx.status.status === 'failed');
        chai.assert(context.nonce.eq(new BN(1)));
    });

    it('should fail non existing extrinsic and not change the nonce', async () => {
        ConfigUtil.set(ConfigUtil.keys.NetworkConfig, path.resolve(__dirname, validConfig));
        const connector = new PolkadotConnector(1, 'polkadot');
        const args = await connector.prepareWorkerArguments(1).should.not.be.rejected;
        const context = await connector.getContext(0, args[0]).should.not.be.rejected;
        chai.assert(context.nonce.eq(new BN(1)));

        // Extrinsic nothere
        let tx = await connector._sendSingleRequest({
            pallet: 'balances',
            extrinsic: 'nothere',
            args: ['ddee1e8626ddd07e85315eb83774f187', 1]
        }).should.not.be.rejected;

        chai.assert(tx.status.status === 'failed');
        chai.assert(context.nonce.eq(new BN(1)));
    });

    it('should fail wrong number of args', async () => {
        ConfigUtil.set(ConfigUtil.keys.NetworkConfig, path.resolve(__dirname, validConfig));
        const connector = new PolkadotConnector(1, 'polkadot');
        const args = await connector.prepareWorkerArguments(1).should.not.be.rejected;
        const context = await connector.getContext(0, args[0]).should.not.be.rejected;

        chai.assert(context.nonce.eq(new BN(1)));

        // Extrinsic nothere
        let tx = await connector._sendSingleRequest({
            pallet: 'balances',
            extrinsic: 'transferKeepAlive',
            args: ['ddee1e8626ddd07e85315eb83774f187']
        }).should.not.be.rejected;

        chai.assert(tx.status.status === 'failed');
        chai.assert(context.nonce.eq(new BN(1)));
    });

    it('should increase nonce after request', async () => {
        ConfigUtil.set(ConfigUtil.keys.NetworkConfig, path.resolve(__dirname, validConfig));
        const connector = new PolkadotConnector(1, 'polkadot');
        const args = await connector.prepareWorkerArguments(1).should.not.be.rejected;
        const context = await connector.getContext(0, args[0]).should.not.be.rejected;

        chai.assert(context.nonce.eq(new BN(1)));

        await connector._sendSingleRequest({
            pallet: 'balances',
            extrinsic: 'transferKeepAlive',
            args: ['ddee1e8626ddd07e85315eb83774f187', 1000]
        }).should.not.be.rejected;

        chai.assert(context.nonce.eq(new BN(2)));
    });

    it('should send a valid signed request', async () => {
        ConfigUtil.set(ConfigUtil.keys.NetworkConfig, path.resolve(__dirname, validConfig));
        const connector = new PolkadotConnector(1, 'polkadot');
        const args = await connector.prepareWorkerArguments(1).should.not.be.rejected;
        await connector.getContext(0, args[0]).should.not.be.rejected;

        const signedTx = '0xabcdef01234567890';

        const tx = await connector._sendSingleRequest({
            signedTx
        }).should.not.be.rejected;

        chai.assert(tx.status.status === 'success');
    });

    it('should send an invalid signed request', async () => {
        ConfigUtil.set(ConfigUtil.keys.NetworkConfig, path.resolve(__dirname, validConfig));
        const connector = new PolkadotConnector(1, 'polkadot');
        const args = await connector.prepareWorkerArguments(1).should.not.be.rejected;
        await connector.getContext(0, args[0]).should.not.be.rejected;

        // Mocked failing tx
        const signedTx = '0xdeadbeef';

        const tx = await connector._sendSingleRequest({
            signedTx
        }).should.not.be.rejected;

        chai.assert(tx.status.status === 'failed');
    });
});
