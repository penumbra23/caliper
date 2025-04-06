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

const { Keyring, ApiPromise, WsProvider } = require('@polkadot/api');
const { BN } = require("@polkadot/util");

const { ConnectorBase, CaliperUtils, ConfigUtil, TxStatus } = require('@hyperledger/caliper-core');

const logger = CaliperUtils.getLogger('polkadot-connector');

/**
 * Extends {BlockchainConnector} for a Polkadot backend.
 */
class PolkadotConnector extends ConnectorBase {

    /**
     * Create a new instance of the {PolkadotConnector} class.
     * @param {number} workerIndex The zero-based index of the worker who wants to create an adapter instance. -1 for the manager process.
     * @param {string} bcType The target SUT type
     */
    constructor(workerIndex, bcType) {
        super(workerIndex, bcType);

        let configPath = CaliperUtils.resolvePath(ConfigUtil.get(ConfigUtil.keys.NetworkConfig));
        let polkadotConfig = require(configPath).polkadot;
        // throws on configuration error
        this.checkConfig(polkadotConfig);

        this.polkadotConfig = polkadotConfig;
        this.workerIndex = workerIndex;
        this.context = undefined;
        this.api = undefined;
    }

    /**
     * Check the Polkadot networkconfig file for errors, throw if invalid
     * @param {object} polkadotConfig The Polkadot networkconfig to check.
     */
    checkConfig(polkadotConfig) {
        if (!polkadotConfig.url) {
            throw new Error(
                'No URL given to access the Polkadot SUT. Please check your network configuration.'
            );
        }

        if (!polkadotConfig.url.toLowerCase().includes('ws')) {
            throw new Error(
                'Please use WebSocket connections for Substrate RPC'
            );
        }

        //TODO: add validation logic for the rest of the configuration object
    }

    /**
     * Initialize the {PolkadotConnector} object.
     * @param {boolean} workerInit Indicates whether the initialization happens in the worker process.
     * @return {object} Promise<boolean> True if the account got unlocked successful otherwise false.
     */
    async init(workerInit) {
        return Promise.resolve(true);
    }

    /**
     * Deploy smart contracts specified in the network configuration file.
     * @return {object} Promise execution for all the contract creations.
     */
    async installSmartContract() {
        return Promise.resolve()
    }

    /**
     * Return the Polkadot context associated with the given callback module name.
     * @param {Number} roundIndex The zero-based round index of the test.
     * @param {object} args worker arguments.
     * @return {object} The assembled Polkadot context.
     * @async
     */
    async getContext(roundIndex, args) {
        this.provider = new WsProvider(this.polkadotConfig.url);
        this.api = await ApiPromise.create({ provider: this.provider });
        // TODO: make key type adjustable via config
        const keyring = new Keyring({ type: 'sr25519' });
        const keyPair = keyring.addFromUri(args.seed);
        let context = {
            clientIndex: this.workerIndex,
            nonce: new BN(0),
            keyPair: keyPair,
            address: keyPair.address,
            api: this.api
        };
        context.nonce = new BN(await this.api.rpc.system.accountNextIndex(context.address));
        this.context = context;
        return context;
    }

    /**
     * Release the given Polkadot context.
     * @async
     */
    async releaseContext() {
        this.api.disconnect();
        this.provider.disconnect();
    }

    /**
     * Submit a transaction to the Polkadot context.
     * @param {PolkadotTx} request Methods call data.
     * @return {Promise<TxStatus>} Result and stats of the transaction invocation.
     */
    async _sendSingleRequest(request) {
        const context = this.context;
        
        const pallet = request.pallet;
        const extrinsic = request.extrinsic;
        const payload = request.args;

        // Set the status as failed
        const txFailed = (status, err) => {
            status.SetErrMsg(err);
            status.SetStatusFail();
        };

        // Completes the task as successful setting the hash as the ID
        const txSuccess = (status, hash) => {
            status.SetID(hash);
            status.SetResult(hash);
            status.SetVerification(true);
            status.SetStatusSuccess();
        };
        
        // Get the last valid nonce and update
        const nonce = context.nonce;
        context.nonce = context.nonce.add(new BN(1));
        
        // We don't use reject because the method needs to resolve to
        // either a failed or successful tx
        return new Promise(async (resolve, reject) => {
            const txStatus = new TxStatus();
            txStatus.SetTimeCreate(Date.now());
            const unsub = await context.api.tx[pallet][extrinsic](...payload)
                .signAndSend(context.keyPair, { nonce }, ({ status, events, txHash, dispatchError}) => {
                    if (status.isInBlock || status.isFinalized) {
                        if (!dispatchError) {
                            txSuccess(txStatus, txHash)
                            unsub();
                            resolve(txStatus);
                            return;
                        }

                        logger.error(`
                            Failed tx on ${pallet}:${extrinsic};
                            nonce: ${context.nonce};
                            dispatchError: ${dispatchError.toString()}`
                        );

                        // TODO: handle Sudo calls
                        
                        let msg = new String();
                        events
                            .filter(({ event }) => this.api.events.system.ExtrinsicFailed.is(event))
                            .forEach(({ event: { data: [error, info] } }) => {
                                if (error.isModule) {
                                    const decoded = this.api.registry.findMetaError(error.asModule);
                                    const { docs } = decoded;
                                    msg = msg + docs.join(' ');
                                } else {
                                    msg = msg + error.toString()
                                }
                            });
                        txFailed(txStatus, msg);
                        unsub();
                        resolve(txStatus);
                    }
                });
        });
    }

    /**
     * It passes deployed contracts addresses to all workers (only known after deploy contract)
     * @param {Number} number of workers to prepare
     * @returns {Array} worker args
     * @async
     */
    async prepareWorkerArguments(number) {
        let result = [];
        if (this.polkadotConfig.seeds.length < number) {
            throw new Error(`Not enough seeds provided; config.seeds ${this.polkadotConfig.seeds.length} < ${number}`)
        }
        for (let i = 0 ; i<= number ; i++) {
            const path = this.polkadotConfig.seeds[i];
            result[i] = {
                seed: path
            };
        }
        return result;
    }
}

module.exports = PolkadotConnector;
