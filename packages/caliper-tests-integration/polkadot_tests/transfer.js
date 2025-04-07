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

/**
 * Workload module for transferring money between accounts.
 * This example demonstrates the basic usage of the PolkadotConnector.
 * 
 * The minimal configuration needs the consumer to specify the pallet and 
 * extrinsic names with the provided arguments to the method.
 * 
 * The pallet, extrinsic and args are passed straight into the PolkadotJS API
 * instance as they are writen in the submitTransaction.
 * 
 * @example 
 * 
 * // This
 * const args = {
 *       pallet: 'balances',
 *       extrinsic: 'transferKeepAlive',
 *       args: [
 *           '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty',
 *           100000000000
 *       ]
 *   };
 *
 * // translets to this 
 * 
 * api.balances.transferKeepAlive('5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty', 100000000000)
 * 
 * @see https://polkadot.js.org/docs/api/cookbook/tx#how-do-i-estimate-the-transaction-fees
 */
class SimpleTransferWorkload extends WorkloadModuleBase {

    /**
     * Initializes the parameters of the workload.
     */
    constructor() {
        super();
    }

    /**
     * Assemble TXs for transferring money.
     */
    async submitTransaction() {
        // Transfer to Bob account
        const args = {
            pallet: 'balances',
            extrinsic: 'transferKeepAlive',
            args: [
                '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty',
                100000000000
            ]
        };

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
