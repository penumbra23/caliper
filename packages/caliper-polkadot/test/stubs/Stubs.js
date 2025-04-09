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

/* eslint-disable require-jsdoc */
const crypto = require('crypto');

function hash(input) {
    const md5sum = crypto.createHash('md5');
    md5sum.update(input);
    return md5sum.digest('hex');
}

// Returned by the API as a transaction that can be sent to the chain
class Submittable {
    constructor(events, shouldFail, msg = undefined) {
        this.events = events;
        this.shouldFail = shouldFail;
        this.msg = msg;
    }

    signAndSend(keyPair, options, callback) {
        // Mimics a short block time
        setTimeout(() => callback(this.generateCallbackPayload(keyPair.toString())), 100);
        return () => {};
    }

    send(callback) {
        // Mimics a short block time
        setTimeout(() => callback(this.generateCallbackPayload(Math.random().toString(36))), 100);
        return () => {};
    }

    generateCallbackPayload(hashSeed) {
        const txHash = hash(hashSeed);
        const status = {
            isInBlock: true
        };

        let dispatchError = undefined;
        const events = this.events;

        if (this.shouldFail) {
            dispatchError = this.msg;
        }

        return { status, txHash, dispatchError, events };
    }
}

class ApiPromise {
    constructor() {
        this.rpc = {
            system: {
                // Default nonce to 1
                accountNextIndex() {
                    return 1;
                }
            }
        };

        this.tx = (signedTx) => {
            // Have a mock value for incorrect transaction
            const failing = signedTx === '0xdeadbeef';
            return new Submittable([], failing, failing ? 'Invalid tx' : undefined);
        };
        this.tx.balances = {
            transferKeepAlive(address, amount) {
                if (address === undefined || amount === undefined) {
                    throw new Error('Wrong number of args.');
                }

                let shouldFail = false;
                let msg = undefined;
                let events = [];

                // Set the existential deposit to 10
                if (amount < 10) {
                    shouldFail = true;
                    msg = 'Amount too small';
                    events.push({
                        event: {
                            isError: true,
                            data: [{
                                isModule: true
                            }]
                        }
                    });
                }
                return new Submittable(events, shouldFail, msg);
            }
        };

        this.events = {
            system: {
                ExtrinsicFailed: {
                    is(event) {
                        return event.isError;
                    }
                }
            }
        };

        this.registry = {
            findMetaError() {
                return {
                    docs: [
                        'error'
                    ]
                };
            }
        };

        this.connected = true;
    }

    static async create({ provider }) {
        this.provider = provider;
        return new ApiPromise();
    }

    disconnect() {
        this.connected = false;
    }
}

class WsProvider {
    constructor() {
        this.connected = true;
    }
    disconnect() {
        this.connected = false;
    }
}

class Keyring {
    constructor({type}) {
        this.type = type;
    }

    addFromUri(uri) {
        const address = hash(uri);
        return {
            address,
            seed: uri
        };
    }
}

class BN {
    constructor(number) {
        this.number = number;
    }

    eq(bn) {
        return this.number = bn.number;
    }

    add(bn) {
        const number = this.number + bn.number;
        return new BN(number);
    }
}

module.exports.WsProvider = WsProvider;
module.exports.ApiPromise = ApiPromise;
module.exports.Keyring = Keyring;
module.exports.BN = BN;
module.exports.hash = hash;