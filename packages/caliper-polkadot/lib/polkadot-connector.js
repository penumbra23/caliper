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
const { BN } = require('@polkadot/util');

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
        let polkadotConfig = undefined;
        if (configPath.endsWith('json')) {
            polkadotConfig = require(configPath).polkadot;
        } else if (configPath.endsWith('yaml') || configPath.endsWith('yml')) {
            polkadotConfig = CaliperUtils.parseYaml(configPath).polkadot;
        } else {
            throw new Error('Network config file needs to be YAML or JSON.');
        }
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

        if (!polkadotConfig.url.toLowerCase().startsWith('ws://') && !polkadotConfig.url.toLowerCase().startsWith('wss://')) {
            throw new Error(
                'URL needs to be a Websocket connection.'
            );
        }
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
     * **NOTE**: Still not being used
     * @return {object} Promise execution for all the contract creations.
     */
    async installSmartContract() {
        return Promise.resolve();
    }

    /**
     * Return the Polkadot context associated with the given callback module name.
     * @param {Number} roundIndex The zero-based round index of the test.
     * @param {object} args Worker arguments returned by prepareWorkerArguments.
     * @return {object} The assembled Polkadot context.
     * @async
     */
    async getContext(roundIndex, args) {
        this.provider = new WsProvider(this.polkadotConfig.url);
        this.api = await ApiPromise.create({ provider: this.provider });
        // TODO: make key type adjustable via config
        const keyring = new Keyring({ type: args.key.type || 'sr25519' });
        const keyPair = keyring.addFromUri(args.key.uri);
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
     * Fails a transaction status by setting the fail flag and error message.
     * @param {TxStatus} txStatus TxStatus
     * @param {Error} err Error message to be set
     * @param {PromiseLike<TxStatus>} resolve Resolves the promise
     */
    _failTx(txStatus, err, resolve) {
        txStatus.SetErrMsg(err);
        txStatus.SetStatusFail();
        resolve(txStatus);
    }

    /**
     * Sets a successful completition on the transaction status.
     * @param {TxStatus} txStatus TxStatus
     * @param {string} hash Transaction hash
     * @param {PromiseLike<TxStatus>} resolve Resolves the promise
     */
    _completeTx(txStatus, hash, resolve) {
        txStatus.SetID(hash);
        txStatus.SetResult(hash);
        txStatus.SetVerification(true);
        txStatus.SetStatusSuccess();
        resolve(txStatus);
    }

    /**
     * Submit a transaction to the Polkadot context.
     * @param {PolkadotTx} request Methods call data.
     * @return {Promise<TxStatus>} Result and stats of the transaction invocation.
     */
    async _sendSingleRequest(request) {
        // We don't use reject because the method needs to resolve to
        // either a failed or successful tx
        return new Promise(async (resolve, reject) => {
            const txStatus = new TxStatus();
            txStatus.SetTimeCreate(Date.now());

            try {
                if (request.signedTx) {
                    await this._handleSignedTx(request.signedTx, txStatus, resolve);
                } else {
                    await this._handleWorkerSigning(request, txStatus, resolve);
                }
            }
            catch(err) {
                logger.error(`Error on submission: ${err}`);
                this._failTx(txStatus, err, resolve);
            }
        });
    }

    /**
     * Handles workload runs with a signed transaction. Useful for singing in the
     * workload module instead.
     *
     * @param {string} signedTx Signed transaction as a hex string
     * @param {TxStatus} txStatus TxStatus
     * @param {PromiseLike<TxStatus>} resolve Resolves the promise
     */
    async _handleSignedTx(signedTx, txStatus, resolve) {
        const context = this.context;
        const unsub = await context.api.tx(signedTx).send(({status, events, txHash, dispatchError}) => {
            if (status.isInBlock || status.isFinalized) {
                if (!dispatchError) {
                    this._completeTx(txStatus, txHash, resolve);
                    unsub();
                    return;
                }

                logger.error(`
                    Failed tx ${signedTx};
                    dispatchError: ${dispatchError.toString()}`
                );

                // TODO: handle Sudo calls

                let msg = new String();
                events
                    .filter(({ event }) => this.api.events.system.ExtrinsicFailed.is(event))
                    .forEach(({ event: { data: [error] } }) => {
                        if (error.isModule) {
                            const decoded = this.api.registry.findMetaError(error.asModule);
                            const { docs } = decoded;
                            msg = msg + docs.join(' ');
                        } else {
                            msg = msg + error.toString();
                        }
                    });
                this._failTx(txStatus, msg, resolve);
                unsub();
            }
        });
    }

    /**
     * Signs and submits the transaction. This method uses the provided keys
     * in the network config file and takes care of increasing the nonce.
     *
     * @param {PolkadotRequest} request PolkadotConnector request
     * @param {TxStatus} txStatus TxStatus
     * @param {PromiseLike<TxStatus>} resolve Resolves the promise
     */
    async _handleWorkerSigning(request, txStatus, resolve) {
        const context = this.context;

        const pallet = request.pallet;
        const extrinsic = request.extrinsic;
        const payload = request.args;

        // Add this before nonce increment
        // In this way we avoid client errors before nonce management
        const tx = context.api.tx[pallet][extrinsic](...payload);

        const nonce = context.nonce;
        context.nonce = context.nonce.add(new BN(1));

        const unsub = await tx.signAndSend(context.keyPair, { nonce }, ({ status, events, txHash, dispatchError }) => {
            if (status.isInBlock || status.isFinalized) {
                if (!dispatchError) {
                    this._completeTx(txStatus, txHash, resolve);
                    unsub();
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
                            msg = msg + error.toString();
                        }
                    });
                this._failTx(txStatus, msg, resolve);
                unsub();
            }
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
            throw new Error(`Not enough seeds provided; config.seeds ${this.polkadotConfig.seeds.length} < ${number}`);
        }
        for (let i = 0 ; i<= number ; i++) {
            const uri = this.polkadotConfig.seeds[i].uri;
            result[i] = {
                key: {
                    uri,
                    type: this.polkadotConfig.seeds[i].type || 'sr25519',
                }
            };
        }
        return result;
    }
}

module.exports = PolkadotConnector;
