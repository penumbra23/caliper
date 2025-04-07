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

const { WorkloadModuleBase } = require('@hyperledger/caliper-core');

const { Keyring, WsProvider, ApiPromise } = require('@polkadot/api');
const { BN } = require('@polkadot/util');

/**
 * Workload module for transferring money between accounts.
 * 
 * This example assumes that the workloads sign the transaction
 * and pass the signed tx to the SUT adapter. This is useful is we have
 * some custom logic for using different keys in the same round.
 * 
 * Because of the fact that signing happens here, we need to import all
 * the necessary dependencies. Also, because of the way Polkadot expects 
 * various runtime configuration to be signed, we also need to initialize
 * the API connection.
 */
class SimpleTransferWorkload extends WorkloadModuleBase {

    /**
     * Initializes the parameters of the workload.
     */
    constructor() {
        super();
    }

    /**
     * Initialize the workload module with the given parameters.
     * @param {number} workerIndex The 0-based index of the worker instantiating the workload module.
     * @param {number} totalWorkers The total number of workers participating in the round.
     * @param {number} roundIndex The 0-based index of the currently executing round.
     * @param {Object} roundArguments The user-provided arguments for the round from the benchmark configuration file.
     * @param {ConnectorBase} sutAdapter The adapter of the underlying SUT.
     * @param {Object} sutContext The custom context object provided by the SUT adapter.
     * @async
     */
    async initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext) {
        await super.initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext);
        this.provider = new WsProvider(sutAdapter.polkadotConfig.url);
        this.api = await ApiPromise.create({ provider: this.provider });

        const keyring = new Keyring({ type: 'sr25519' });
        const keyPair = keyring.addFromUri("//Bob");
        this.keyPair = keyPair;

        this.nonce = new BN(await this.api.rpc.system.accountNextIndex(keyPair.address));
    }

    /**
     * Assemble TXs for transferring money. Signing happens here.
     */
    async submitTransaction() {
        // Transfer to Alice account
        let transaction = this.api.tx.balances.transferKeepAlive('5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY', 100000000);

        const nonce = this.nonce;
        this.nonce = this.nonce.add(new BN(1));

        const options = {};
        options.nonce = nonce;
        options.blockHash = this.api.genesisHash;

        let signedTx = await transaction.signAsync(this.keyPair, options);

        const args = {
            signedTx
        }

        await this.sutAdapter.sendRequests(args);
    }
}

/**
 * Create a new instance of the workload module.
 * @return {WorkloadModuleInterface}
 */
function createWorkloadModule() {
    return new SimpleTransferWorkload();
}

module.exports.createWorkloadModule = createWorkloadModule;
