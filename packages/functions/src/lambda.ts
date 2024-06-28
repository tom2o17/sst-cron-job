import { ethers } from "ethers";
import { Config } from "sst/node/config";
const axios = require("axios");

const fraxtal = Config.FRAXTAL_URL;
const mainnet = Config.MAINNET_URL;
const pk = Config.PK;
const tgToken = Config.tgToken;

export async function main() {
    await pushNotification("👟 Function initiated 👟");
    await run();
    return {};
}

const SFRAX_MAINNET = "0xA663B02CF0a4b149d2aD41910CB81e23e1c41c32";
const SFRAX_ORACLE = "0x1B680F4385f24420D264D78cab7C58365ED3F1FF";
const SFRAX_PROOVER = "0xE25D8aaa6dF41B94A415EE39cCEE0DF6673B9bDb";

type Proof = {
    _accountProofSUSDe: any,
    _storageProofTS: any,
    _storageProofLastDist: any,
    _storageProofVestingAmount: any,
    _accountProofUSDe: any,
    _storageProofUSDeBalance: any
}


async function proveStateRoot(
    wallet: ethers.Wallet, 
    mainnet: ethers.providers.JsonRpcProvider
) {

    // Fetch most recent block from the L1 provider on Fraxtal
    let l1PoviderFraxtal = new ethers.Contract(
        "0x4200000000000000000000000000000000000015",
        L1_PROVIDER,
        wallet
    );
    let blockL1 = await l1PoviderFraxtal.number();

    let mainnetHeader = await getHeaderFromBlock(mainnet, blockL1.toHexString());
    
    let fraxtalStateRootOracle = new ethers.Contract(
        "0xeD403d48e2bC946438B5686AA1AD65056Ccf9512",
        STATEROOT_ORACLE,
        wallet
    );
    // Prover Header on L2 
    let txn = await fraxtalStateRootOracle.proveStateRoot(mainnetHeader, {
        maxFeePerGas: 1e6,
        maxPriorityFeePerGas: 1e6
    });
    txn.wait();
    return blockL1
}

async function getHeaderFromBlock(provider, blockL1) {
    let block = await provider.send("eth_getBlockByNumber", [blockL1, false])
    let headerFields = [];
    headerFields.push(block.parentHash);
    headerFields.push(block.sha3Uncles);
    headerFields.push(block.miner);
    headerFields.push(block.stateRoot);
    headerFields.push(block.transactionsRoot);
    headerFields.push(block.receiptsRoot);
    headerFields.push(block.logsBloom);
    headerFields.push(block.difficulty);
    headerFields.push(block.number);
    headerFields.push(block.gasLimit);
    headerFields.push(block.gasUsed);
    headerFields.push(block.timestamp);
    headerFields.push(block.extraData);
    headerFields.push(block.mixHash);
    headerFields.push(block.nonce);
    headerFields.push(block.baseFeePerGas);
    if (block.withdrawalsRoot) {
        headerFields.push(block.withdrawalsRoot);
    }
    if (block.blobGasUsed) {
        headerFields.push(block.blobGasUsed);
    }
    if (block.excessBlobGas) {
        headerFields.push(block.excessBlobGas);
    }
    if (block.parentBeaconBlockRoot) {
        headerFields.push(block.parentBeaconBlockRoot);
    }
    convertHeaderFields(headerFields);
    let header = ethers.utils.RLP.encode(headerFields);
    return header
}

function convertHeaderFields(headerFields) {
    for (var i = 0; i < headerFields.length; i++) {
      var field = headerFields[i];
      if (field == "0x0") field = "0x";
      if (field.length % 2 == 1) field = "0x0" + field.substring(2);
      headerFields[i] = field;
    }
}

async function pushNotification(msg: String) {
    const API_URL_SEND = `https://api.telegram.org/bot${tgToken}/sendMessage`;
    const payload = {
        chat_id: "-4243677873",
        text: msg,
        disable_notifications: false,
        parse_mode: "MarkdownV2",
        link_preview_options: {
            is_disabled: true
        }
    }
    await axios.post(API_URL_SEND, payload, {
        headers: {
            'Content-Type': 'application/json'
        }
    });
}

function sleep(ms: number) {
    return new Promise( resolve => setTimeout(resolve, ms) );
}


async function run() {
    const mainnetProvider = new ethers.providers.JsonRpcProvider({
        skipFetchSetup: true,
        url: mainnet
    });
    const fraxtalProvider = new ethers.providers.JsonRpcProvider({
        skipFetchSetup: true,
        url: fraxtal
    });
    let wallet = new ethers.Wallet(pk, fraxtalProvider)

    let toPost = new ethers.Contract(
        SFRAX_ORACLE,
        SFRAX_ORACLE_ABI,
        fraxtalProvider
    );
    let proover = new ethers.Contract(
        SFRAX_PROOVER,
        SFRAX_PROOVER_ABI,
        wallet
    );
    let toCheck = new ethers.Contract(
        SFRAX_MAINNET,
        SFRAX_ABI,
        mainnetProvider
    )

    let res_main = await toCheck.previewRedeem(ethers.utils.parseUnits("1"));
    let res_fraxtal = await toPost.getPrices();
    let diff = res_main.sub(res_fraxtal[1]).abs();
    let threshold = ethers.utils.parseEther("0.0000001");

    let maxDistributionPerSecond = await toCheck.maxDistributionPerSecondPerAsset();
    let maxDistOracle = await toPost.maxDistributionPerSecondPerAsset();
    console.log(maxDistributionPerSecond, maxDistOracle);

    console.log(res_main.toString(), res_fraxtal[1].toString());
    if (!maxDistOracle.eq(maxDistributionPerSecond)) {
        let blockL1 = await proveStateRoot(wallet, mainnetProvider);
        let blockToProof = "0x"+blockL1.toHexString().substring(2).replace(/^0+/, "");
        let sfrax_proof = await mainnetProvider.send("eth_getProof", 
        [
            SFRAX_MAINNET, 
            [
                "0x000000000000000000000000000000000000000000000000000000000000000C"
            ], 
            blockToProof
        ]);
        let count = await fraxtalProvider.getTransactionCount(wallet.address);
        let txn = await proover.addMaxDistributionPerSecond(
            SFRAX_ORACLE,
            blockL1.toString(),
            sfrax_proof.accountProof,
            sfrax_proof.storageProof[0].proof,
            {
                gasLimit: 3_000_000,
                maxFeePerGas: 1e6 - 1,
                maxPriorityFeePerGas: 1e6 - 1,
                nonce: count + 1
            }
        );
        txn.wait();
        await pushNotification(`🟢 MaxDistribution Info Pushed to L2 🟢 \n [Transaction](https://fraxscan.com/tx/${txn.hash})`);
        await sleep(10_000);
    }

    

    let cycleEndMainnet = (await toCheck.rewardsCycleData())[0];
    let cycleEndL2 = (await toPost.rewardsCycleData())[0];
    // console.log(cycleEndL2.toString(), cycleEndMainnet.toString());
    // console.log(cycleEndL2, cycleEndMainnet);
    if (diff.gt(threshold) || !cycleEndL2.toString() == cycleEndMainnet.toString()) {
        console.log("Condition Hit");
        let blockL1 = await proveStateRoot(wallet, mainnetProvider);
        let blockToProof = "0x"+blockL1.toHexString().substring(2).replace(/^0+/, "");

        let sfrax_proof = await mainnetProvider.send("eth_getProof", 
        [
            SFRAX_MAINNET, 
            [
                "0x0000000000000000000000000000000000000000000000000000000000000002",
                "0x0000000000000000000000000000000000000000000000000000000000000009",
                "0x0000000000000000000000000000000000000000000000000000000000000008",
                "0x0000000000000000000000000000000000000000000000000000000000000006",
                "0x0000000000000000000000000000000000000000000000000000000000000007"
            ], 
            blockToProof
        ]);

        let proof: Proof = {} as Proof;
        proof._accountProofSfrax = sfrax_proof.accountProof;
        proof._storageProofTotalSupply = sfrax_proof.storageProof[0].proof;
        proof._storageProofTotalAssets = sfrax_proof.storageProof[1].proof;
        proof._storageProofLastDist = sfrax_proof.storageProof[2].proof;
        proof._storageProofRewardsPacked = sfrax_proof.storageProof[3].proof;
        proof._storageProofRewardsCycleAmount = sfrax_proof.storageProof[4].proof;

        const count = await fraxtalProvider.getTransactionCount(wallet.address);
        let txn = await proover.addRoundDataSfrax(
            SFRAX_ORACLE,
            blockL1.toString(),
            proof,
            {
                gasLimit: 3_000_000,
                maxFeePerGas: 1e6 - 1,
                maxPriorityFeePerGas: 1e6 - 1,
                nonce: count + 1
            }
        );
        txn.wait();
        console.log(txn.hash);
        await pushNotification(`🟢 Vault Info Pushed to L2 🟢 \n [Transaction](https://fraxscan.com/tx/${txn.hash})`);
    } else {
        console.log("There is nothing to proof");
        await pushNotification(`☑️ Vault on L2 current w/ L1 ☑️\n The difference is ${diff.toString()} \n The threshold is ${threshold.toString()}`);
    }
}

const L1_PROVIDER = [{"anonymous":false,"inputs":[{"indexed":false,"internalType":"bytes32","name":"blockHash","type":"bytes32"}],"name":"BlockHashReceived","type":"event"},{"inputs":[],"name":"DEPOSITOR_ACCOUNT","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"baseFeeScalar","outputs":[{"internalType":"uint32","name":"","type":"uint32"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"basefee","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"batcherHash","outputs":[{"internalType":"bytes32","name":"","type":"bytes32"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"blobBaseFee","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"blobBaseFeeScalar","outputs":[{"internalType":"uint32","name":"","type":"uint32"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"bytes32","name":"_blockHash","type":"bytes32"}],"name":"blockHashStored","outputs":[{"internalType":"bool","name":"_result","type":"bool"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"hash","outputs":[{"internalType":"bytes32","name":"","type":"bytes32"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"l1FeeOverhead","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"l1FeeScalar","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"number","outputs":[{"internalType":"uint64","name":"","type":"uint64"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"sequenceNumber","outputs":[{"internalType":"uint64","name":"","type":"uint64"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint64","name":"_number","type":"uint64"},{"internalType":"uint64","name":"_timestamp","type":"uint64"},{"internalType":"uint256","name":"_basefee","type":"uint256"},{"internalType":"bytes32","name":"_hash","type":"bytes32"},{"internalType":"uint64","name":"_sequenceNumber","type":"uint64"},{"internalType":"bytes32","name":"_batcherHash","type":"bytes32"},{"internalType":"uint256","name":"_l1FeeOverhead","type":"uint256"},{"internalType":"uint256","name":"_l1FeeScalar","type":"uint256"}],"name":"setL1BlockValues","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"setL1BlockValuesEcotone","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"bytes32","name":"","type":"bytes32"}],"name":"storedBlockHashes","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"timestamp","outputs":[{"internalType":"uint64","name":"","type":"uint64"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"version","outputs":[{"internalType":"string","name":"","type":"string"}],"stateMutability":"view","type":"function"}]
const STATEROOT_ORACLE = [{"inputs":[{"internalType":"contract IBlockHashProvider[]","name":"_providers","type":"address[]"},{"internalType":"uint256","name":"_minimumRequiredProviders","type":"uint256"},{"internalType":"address","name":"_timelockAddress","type":"address"}],"stateMutability":"nonpayable","type":"constructor"},{"inputs":[],"name":"MinimumRequiredProvidersTooLow","type":"error"},{"inputs":[],"name":"NotEnoughProviders","type":"error"},{"inputs":[],"name":"OnlyPendingTimelock","type":"error"},{"inputs":[],"name":"OnlyTimelock","type":"error"},{"inputs":[],"name":"ProviderAlreadyAdded","type":"error"},{"inputs":[],"name":"ProviderNotFound","type":"error"},{"inputs":[],"name":"SameMinimumRequiredProviders","type":"error"},{"inputs":[{"internalType":"uint256","name":"blockNumber","type":"uint256"}],"name":"StateRootAlreadyProvenForBlockNumber","type":"error"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"uint40","name":"blockNumber","type":"uint40"},{"indexed":false,"internalType":"uint40","name":"timestamp","type":"uint40"},{"indexed":false,"internalType":"bytes32","name":"stateRootHash","type":"bytes32"}],"name":"BlockVerified","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"address","name":"provider","type":"address"}],"name":"ProviderAdded","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"address","name":"provider","type":"address"}],"name":"ProviderRemoved","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"uint256","name":"oldMinimumRequiredProviders","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"newMinimumRequiredProviders","type":"uint256"}],"name":"SetMinimumRequiredProviders","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"previousTimelock","type":"address"},{"indexed":true,"internalType":"address","name":"newTimelock","type":"address"}],"name":"TimelockTransferStarted","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"previousTimelock","type":"address"},{"indexed":true,"internalType":"address","name":"newTimelock","type":"address"}],"name":"TimelockTransferred","type":"event"},{"inputs":[],"name":"acceptTransferTimelock","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"contract IBlockHashProvider","name":"_provider","type":"address"}],"name":"addProvider","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"uint256","name":"","type":"uint256"}],"name":"blockHashProviders","outputs":[{"internalType":"contract IBlockHashProvider","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"blockNumber","type":"uint256"}],"name":"blockNumberToBlockInfo","outputs":[{"internalType":"bytes32","name":"stateRootHash","type":"bytes32"},{"internalType":"uint40","name":"timestamp","type":"uint40"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"getBlockHashProvidersCount","outputs":[{"internalType":"uint256","name":"_providersCount","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"_blockNumber","type":"uint256"}],"name":"getBlockInfo","outputs":[{"components":[{"internalType":"bytes32","name":"stateRootHash","type":"bytes32"},{"internalType":"uint40","name":"timestamp","type":"uint40"}],"internalType":"struct IStateRootOracle.BlockInfo","name":"_blockInfo","type":"tuple"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"minimumRequiredProviders","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"pendingTimelockAddress","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"bytes","name":"_blockHeader","type":"bytes"}],"name":"proveStateRoot","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"contract IBlockHashProvider","name":"_provider","type":"address"}],"name":"removeProvider","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"renounceTimelock","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"uint256","name":"_minimumRequiredProviders","type":"uint256"}],"name":"setMinimumRequiredProviders","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"bytes4","name":"interfaceId","type":"bytes4"}],"name":"supportsInterface","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"timelockAddress","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"_newTimelock","type":"address"}],"name":"transferTimelock","outputs":[],"stateMutability":"nonpayable","type":"function"}];
const SFRAX_PROOVER_ABI = [{"inputs":[{"internalType":"address","name":"_stateRootOracle","type":"address"},{"internalType":"address","name":"_timelockAddress","type":"address"}],"stateMutability":"nonpayable","type":"constructor"},{"inputs":[],"name":"MustBeGtZero","type":"error"},{"inputs":[],"name":"OnlyPendingTimelock","type":"error"},{"inputs":[],"name":"OnlyTimelock","type":"error"},{"inputs":[{"internalType":"address","name":"fraxOracleLayer1","type":"address"},{"internalType":"address","name":"fraxOracleLayer2","type":"address"}],"name":"OraclePairAlreadySet","type":"error"},{"inputs":[],"name":"StalePush","type":"error"},{"inputs":[],"name":"WrongOracleAddress","type":"error"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"fraxOracleLayer1","type":"address"},{"indexed":true,"internalType":"address","name":"fraxOracleLayer2","type":"address"}],"name":"OraclePairAdded","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"previousTimelock","type":"address"},{"indexed":true,"internalType":"address","name":"newTimelock","type":"address"}],"name":"TimelockTransferStarted","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"previousTimelock","type":"address"},{"indexed":true,"internalType":"address","name":"newTimelock","type":"address"}],"name":"TimelockTransferred","type":"event"},{"inputs":[],"name":"STATE_ROOT_ORACLE","outputs":[{"internalType":"contract IStateRootOracle","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"_sFraxAddress","type":"address"},{"internalType":"uint96","name":"_blockNumber","type":"uint96"},{"internalType":"bytes[]","name":"_accountProofSfrax","type":"bytes[]"},{"internalType":"bytes[]","name":"_storageProofMaxDistPerSecond","type":"bytes[]"}],"name":"_fetchAndProofMaxRewards","outputs":[{"internalType":"uint256","name":"maxDistributionPerSecond","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"acceptTransferTimelock","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"contract IERC4626Receiver","name":"_sFraxOracle","type":"address"},{"internalType":"uint96","name":"_blockNumber","type":"uint96"},{"internalType":"bytes[]","name":"_accountProofSfrax","type":"bytes[]"},{"internalType":"bytes[]","name":"_storageProofMaxDistPerSecond","type":"bytes[]"}],"name":"addMaxDistributionPerSecond","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"components":[{"internalType":"address","name":"layer1FraxOracle","type":"address"},{"internalType":"address","name":"layer2FraxOracle","type":"address"}],"internalType":"struct MerkleProofPriceSourceSfrax.OraclePair[]","name":"_oraclePairs","type":"tuple[]"}],"name":"addOraclePairs","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"contract IERC4626Receiver","name":"_sFraxOracle","type":"address"},{"internalType":"uint96","name":"_blockNumber","type":"uint96"},{"components":[{"internalType":"bytes[]","name":"_accountProofSfrax","type":"bytes[]"},{"internalType":"bytes[]","name":"_storageProofTotalSupply","type":"bytes[]"},{"internalType":"bytes[]","name":"_storageProofTotalAssets","type":"bytes[]"},{"internalType":"bytes[]","name":"_storageProofLastDist","type":"bytes[]"},{"internalType":"bytes[]","name":"_storageProofRewardsPacked","type":"bytes[]"},{"internalType":"bytes[]","name":"_storageProofRewardsCycleAmount","type":"bytes[]"}],"internalType":"struct MerkleProofPriceSourceSfrax.PoofPackedsFrax","name":"proof","type":"tuple"}],"name":"addRoundDataSfrax","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"layer2FraxOracle","type":"address"}],"name":"oracleLookup","outputs":[{"internalType":"address","name":"layer1Oracle","type":"address"},{"internalType":"uint96","name":"lastBlockProofed","type":"uint96"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"pendingTimelockAddress","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"renounceTimelock","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"bytes4","name":"interfaceId","type":"bytes4"}],"name":"supportsInterface","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"timelockAddress","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"_newTimelock","type":"address"}],"name":"transferTimelock","outputs":[],"stateMutability":"nonpayable","type":"function"}];
const SFRAX_ORACLE_ABI = [{"inputs":[{"internalType":"address","name":"_timelock","type":"address"},{"internalType":"address","name":"_priceSource","type":"address"}],"stateMutability":"nonpayable","type":"constructor"},{"inputs":[],"name":"CastError","type":"error"},{"inputs":[],"name":"OnlyPendingTimelock","type":"error"},{"inputs":[],"name":"OnlyPriceSource","type":"error"},{"inputs":[],"name":"OnlyTimelock","type":"error"},{"inputs":[],"name":"SamePriceSource","type":"error"},{"inputs":[],"name":"StalePush","type":"error"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"uint256","name":"newMax","type":"uint256"}],"name":"MaxDistributionPerSecondPerAssetUpdated","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"address","name":"oldPriceSource","type":"address"},{"indexed":false,"internalType":"address","name":"newPriceSource","type":"address"}],"name":"SetPriceSource","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"previousTimelock","type":"address"},{"indexed":true,"internalType":"address","name":"newTimelock","type":"address"}],"name":"TimelockTransferStarted","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"previousTimelock","type":"address"},{"indexed":true,"internalType":"address","name":"newTimelock","type":"address"}],"name":"TimelockTransferred","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"uint256","name":"totalSupply","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"totalStoredAssets","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"lastRewardsDistribution","type":"uint256"},{"components":[{"internalType":"uint40","name":"cycleEnd","type":"uint40"},{"internalType":"uint40","name":"lastSync","type":"uint40"},{"internalType":"uint216","name":"rewardCycleAmount","type":"uint216"}],"indexed":false,"internalType":"struct FraxtalERC4626TransportOracle.RewardsCycleData","name":"data","type":"tuple"}],"name":"VaultDataUpdated","type":"event"},{"inputs":[],"name":"acceptTransferTimelock","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"components":[{"internalType":"uint40","name":"cycleEnd","type":"uint40"},{"internalType":"uint40","name":"lastSync","type":"uint40"},{"internalType":"uint216","name":"rewardCycleAmount","type":"uint216"}],"internalType":"struct FraxtalERC4626TransportOracle.RewardsCycleData","name":"_rewardsCycleData","type":"tuple"},{"internalType":"uint256","name":"_deltaTime","type":"uint256"}],"name":"calculateRewardsToDistribute","outputs":[{"internalType":"uint256","name":"_rewardToDistribute","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"decimals","outputs":[{"internalType":"uint8","name":"_decimals","type":"uint8"}],"stateMutability":"pure","type":"function"},{"inputs":[],"name":"description","outputs":[{"internalType":"string","name":"_description","type":"string"}],"stateMutability":"pure","type":"function"},{"inputs":[],"name":"getPrices","outputs":[{"internalType":"bool","name":"isBadData","type":"bool"},{"internalType":"uint256","name":"_priceLow","type":"uint256"},{"internalType":"uint256","name":"_priceHigh","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"lastL1Block","outputs":[{"internalType":"uint96","name":"","type":"uint96"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"lastRewardsDistribution","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"latestRoundData","outputs":[{"internalType":"uint80","name":"roundId","type":"uint80"},{"internalType":"int256","name":"answer","type":"int256"},{"internalType":"uint256","name":"startedAt","type":"uint256"},{"internalType":"uint256","name":"updatedAt","type":"uint256"},{"internalType":"uint80","name":"answeredInRound","type":"uint80"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"maxDistributionPerSecondPerAsset","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"name","outputs":[{"internalType":"string","name":"_name","type":"string"}],"stateMutability":"pure","type":"function"},{"inputs":[],"name":"pendingTimelockAddress","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"previewDistributeRewards","outputs":[{"internalType":"uint256","name":"_rewardToDistribute","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"pricePerShare","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"priceSource","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"renounceTimelock","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"rewardsCycleData","outputs":[{"internalType":"uint40","name":"cycleEnd","type":"uint40"},{"internalType":"uint40","name":"lastSync","type":"uint40"},{"internalType":"uint216","name":"rewardCycleAmount","type":"uint216"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"_newPriceSource","type":"address"}],"name":"setPriceSource","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"storedTotalAssets","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"bytes4","name":"interfaceId","type":"bytes4"}],"name":"supportsInterface","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"timelockAddress","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"totalAssets","outputs":[{"internalType":"uint256","name":"_totalAssets","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"totalSupply","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"_newTimelock","type":"address"}],"name":"transferTimelock","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"uint96","name":"_l1BlockNumber","type":"uint96"},{"internalType":"uint256","name":"_maxPerSecond","type":"uint256"}],"name":"updateMaxDistributionPerSecond","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"uint96","name":"_l1BlockNumber","type":"uint96"},{"internalType":"uint256","name":"_totalSupply","type":"uint256"},{"internalType":"uint256","name":"_totalAssets","type":"uint256"},{"internalType":"uint256","name":"_lastRewardsDistribution","type":"uint256"},{"components":[{"internalType":"uint40","name":"cycleEnd","type":"uint40"},{"internalType":"uint40","name":"lastSync","type":"uint40"},{"internalType":"uint216","name":"rewardCycleAmount","type":"uint216"}],"internalType":"struct FraxtalERC4626TransportOracle.RewardsCycleData","name":"_data","type":"tuple"}],"name":"updatesFRAXData","outputs":[],"stateMutability":"nonpayable","type":"function"}];
const SFRAX_ABI = [{"inputs":[{"internalType":"contract IERC20","name":"_underlying","type":"address"},{"internalType":"string","name":"_name","type":"string"},{"internalType":"string","name":"_symbol","type":"string"},{"internalType":"uint32","name":"_rewardsCycleLength","type":"uint32"},{"internalType":"uint256","name":"_maxDistributionPerSecondPerAsset","type":"uint256"},{"internalType":"address","name":"_timelockAddress","type":"address"}],"stateMutability":"nonpayable","type":"constructor"},{"inputs":[{"internalType":"address","name":"pendingTimelockAddress","type":"address"},{"internalType":"address","name":"actualAddress","type":"address"}],"name":"AddressIsNotPendingTimelock","type":"error"},{"inputs":[{"internalType":"address","name":"timelockAddress","type":"address"},{"internalType":"address","name":"actualAddress","type":"address"}],"name":"AddressIsNotTimelock","type":"error"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"owner","type":"address"},{"indexed":true,"internalType":"address","name":"spender","type":"address"},{"indexed":false,"internalType":"uint256","name":"amount","type":"uint256"}],"name":"Approval","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"caller","type":"address"},{"indexed":true,"internalType":"address","name":"owner","type":"address"},{"indexed":false,"internalType":"uint256","name":"assets","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"shares","type":"uint256"}],"name":"Deposit","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"uint256","name":"rewardsToDistribute","type":"uint256"}],"name":"DistributeRewards","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"uint256","name":"oldMax","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"newMax","type":"uint256"}],"name":"SetMaxDistributionPerSecondPerAsset","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"uint40","name":"cycleEnd","type":"uint40"},{"indexed":false,"internalType":"uint40","name":"lastSync","type":"uint40"},{"indexed":false,"internalType":"uint216","name":"rewardCycleAmount","type":"uint216"}],"name":"SyncRewards","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"previousTimelock","type":"address"},{"indexed":true,"internalType":"address","name":"newTimelock","type":"address"}],"name":"TimelockTransferStarted","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"previousTimelock","type":"address"},{"indexed":true,"internalType":"address","name":"newTimelock","type":"address"}],"name":"TimelockTransferred","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"from","type":"address"},{"indexed":true,"internalType":"address","name":"to","type":"address"},{"indexed":false,"internalType":"uint256","name":"amount","type":"uint256"}],"name":"Transfer","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"caller","type":"address"},{"indexed":true,"internalType":"address","name":"receiver","type":"address"},{"indexed":true,"internalType":"address","name":"owner","type":"address"},{"indexed":false,"internalType":"uint256","name":"assets","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"shares","type":"uint256"}],"name":"Withdraw","type":"event"},{"inputs":[],"name":"DOMAIN_SEPARATOR","outputs":[{"internalType":"bytes32","name":"","type":"bytes32"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"PRECISION","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"REWARDS_CYCLE_LENGTH","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"UNDERLYING_PRECISION","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"acceptTransferTimelock","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"","type":"address"},{"internalType":"address","name":"","type":"address"}],"name":"allowance","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"spender","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"approve","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"asset","outputs":[{"internalType":"contract ERC20","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"","type":"address"}],"name":"balanceOf","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"components":[{"internalType":"uint40","name":"cycleEnd","type":"uint40"},{"internalType":"uint40","name":"lastSync","type":"uint40"},{"internalType":"uint216","name":"rewardCycleAmount","type":"uint216"}],"internalType":"struct LinearRewardsErc4626.RewardsCycleData","name":"_rewardsCycleData","type":"tuple"},{"internalType":"uint256","name":"_deltaTime","type":"uint256"}],"name":"calculateRewardsToDistribute","outputs":[{"internalType":"uint256","name":"_rewardToDistribute","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"shares","type":"uint256"}],"name":"convertToAssets","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"assets","type":"uint256"}],"name":"convertToShares","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"decimals","outputs":[{"internalType":"uint8","name":"","type":"uint8"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"_assets","type":"uint256"},{"internalType":"address","name":"_receiver","type":"address"}],"name":"deposit","outputs":[{"internalType":"uint256","name":"_shares","type":"uint256"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"uint256","name":"_assets","type":"uint256"},{"internalType":"address","name":"_receiver","type":"address"},{"internalType":"uint256","name":"_deadline","type":"uint256"},{"internalType":"bool","name":"_approveMax","type":"bool"},{"internalType":"uint8","name":"_v","type":"uint8"},{"internalType":"bytes32","name":"_r","type":"bytes32"},{"internalType":"bytes32","name":"_s","type":"bytes32"}],"name":"depositWithSignature","outputs":[{"internalType":"uint256","name":"_shares","type":"uint256"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"lastRewardsDistribution","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"","type":"address"}],"name":"maxDeposit","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"maxDistributionPerSecondPerAsset","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"","type":"address"}],"name":"maxMint","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"owner","type":"address"}],"name":"maxRedeem","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"owner","type":"address"}],"name":"maxWithdraw","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"_shares","type":"uint256"},{"internalType":"address","name":"_receiver","type":"address"}],"name":"mint","outputs":[{"internalType":"uint256","name":"_assets","type":"uint256"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"name","outputs":[{"internalType":"string","name":"","type":"string"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"","type":"address"}],"name":"nonces","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"pendingTimelockAddress","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"owner","type":"address"},{"internalType":"address","name":"spender","type":"address"},{"internalType":"uint256","name":"value","type":"uint256"},{"internalType":"uint256","name":"deadline","type":"uint256"},{"internalType":"uint8","name":"v","type":"uint8"},{"internalType":"bytes32","name":"r","type":"bytes32"},{"internalType":"bytes32","name":"s","type":"bytes32"}],"name":"permit","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"uint256","name":"assets","type":"uint256"}],"name":"previewDeposit","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"previewDistributeRewards","outputs":[{"internalType":"uint256","name":"_rewardToDistribute","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"shares","type":"uint256"}],"name":"previewMint","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"shares","type":"uint256"}],"name":"previewRedeem","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"previewSyncRewards","outputs":[{"components":[{"internalType":"uint40","name":"cycleEnd","type":"uint40"},{"internalType":"uint40","name":"lastSync","type":"uint40"},{"internalType":"uint216","name":"rewardCycleAmount","type":"uint216"}],"internalType":"struct LinearRewardsErc4626.RewardsCycleData","name":"_newRewardsCycleData","type":"tuple"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"assets","type":"uint256"}],"name":"previewWithdraw","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"pricePerShare","outputs":[{"internalType":"uint256","name":"_pricePerShare","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"_shares","type":"uint256"},{"internalType":"address","name":"_receiver","type":"address"},{"internalType":"address","name":"_owner","type":"address"}],"name":"redeem","outputs":[{"internalType":"uint256","name":"_assets","type":"uint256"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"renounceTimelock","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"rewardsCycleData","outputs":[{"internalType":"uint40","name":"cycleEnd","type":"uint40"},{"internalType":"uint40","name":"lastSync","type":"uint40"},{"internalType":"uint216","name":"rewardCycleAmount","type":"uint216"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"_maxDistributionPerSecondPerAsset","type":"uint256"}],"name":"setMaxDistributionPerSecondPerAsset","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"storedTotalAssets","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"symbol","outputs":[{"internalType":"string","name":"","type":"string"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"syncRewardsAndDistribution","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"timelockAddress","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"totalAssets","outputs":[{"internalType":"uint256","name":"_totalAssets","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"totalSupply","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"to","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"transfer","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"from","type":"address"},{"internalType":"address","name":"to","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"transferFrom","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"_newTimelock","type":"address"}],"name":"transferTimelock","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"uint256","name":"_assets","type":"uint256"},{"internalType":"address","name":"_receiver","type":"address"},{"internalType":"address","name":"_owner","type":"address"}],"name":"withdraw","outputs":[{"internalType":"uint256","name":"_shares","type":"uint256"}],"stateMutability":"nonpayable","type":"function"}];
