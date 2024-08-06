const { ConnectorBase, CaliperUtils, TxStatus, ConfigUtil } = require("@hyperledger/caliper-core");
const { ApiPromise, WsProvider, Keyring } = require('@polkadot/api');

const logger = CaliperUtils.getLogger('substrate-connector');

class SubstrateConnector extends ConnectorBase {
    constructor(workerIndex, bcType) {
        super(workerIndex, bcType);
        let configPath = CaliperUtils.resolvePath(ConfigUtil.get(ConfigUtil.keys.NetworkConfig));
        this.substrateConfig = require(configPath).substrate;
        this.keyring = new Keyring({
            ss58Format: this.substrateConfig.ss58Format,
            type: 'sr25519'
        })
    }

    async prepareWorkerArguments(number) {
        let result = [];
        for (let i = 0 ; i  < number; i++) {
            result[i] = {
                seed: this.substrateConfig.seeds[i],
            };
        }
        return result;
    }

    async getContext(roundIndex, args) {
        const wsProvider = new WsProvider(this.substrateConfig.url);
        const api = await ApiPromise.create({ provider: wsProvider, noInitWarn: true, throwOnConnect: false });
        
        let keyPair = this.keyring.addFromUri(args.seed);
        let nonce = await api.rpc.system.accountNextIndex(keyPair.address);
        
        let context = {
            keyPair,
            api,
            wsProvider,
            nonces: {},
        };

        context.nonces[keyPair.address] = nonce;

        this.context = context;
        return context;
    }

    async releaseContext() {
        await this.context.api.disconnect();
        await this.context.wsProvider.disconnect();
    }

    async init() {}

    async installSmartContract() {
        return Promise.resolve();
    }

    async _sendSingleRequest(request) {
        let txStatus = new TxStatus();
        let context = this.context;
        let senderAddress = context.keyPair.address;
        
        let res = new Promise(async (resolve, reject) => {
        try {
            let nonce = context.nonces[senderAddress];
            context.nonces[senderAddress] = nonce.addn(1);
            const unsub = await context.api
                .tx[request.pallet][request.extrinsic](...request.args)
                .signAndSend(context.keyPair, { nonce: nonce }, ({ events = [], status, txHash }) => {
                    txStatus.SetID(txHash);
                    txStatus.SetResult(status);
                    txStatus.SetVerification(true);

                    if (status.isInBlock) {
                        txStatus.SetStatusSuccess();
                        resolve(txStatus);
                        unsub();
                    }
                    
                    if (status.isDropped || status.isInvalid || status.isRetracted) {
                        txStatus.SetStatusFail();
                        resolve(txStatus);
                        unsub();
                    }
                });
        } catch(e) {
            txStatus.SetStatusFail();
            logger.error(e)
            resolve(txStatus);
        }
        });
        return res;
    }
}

module.exports = SubstrateConnector;