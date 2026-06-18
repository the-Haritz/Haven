import { parseEther, formatEther, createWalletClient, http } from 'viem';
import { baseSepolia } from 'viem/chains';
import { prisma } from '../infrastructure/db';
import { WalletService } from '../usecases/WalletService';
import { publicClient } from '../infrastructure/viem';

// In a real app, this should be an environment variable.
const HOT_WALLET_ADDRESS = process.env.HOT_WALLET_ADDRESS || '0x0000000000000000000000000000000000000000';

// Do not attempt to sweep dust. If the balance is less than this, ignore it.
const MIN_SWEEP_THRESHOLD = parseEther('0.005');

const walletService = new WalletService();

async function sweep() {
  console.log('🧹 Starting Sweeper Worker...');

  // 1. Fetch all user wallets from our database
  // Note: For massive scale, this should be paginated or streamed.
  const wallets = await prisma.wallet.findMany();

  for (const wallet of wallets) {
    try {
      // 2. Query the RPC for the *actual* on-chain ETH balance
      // We don't rely on our internal ledger for this, because the ledger 
      // tracks the user's platform balance, not the specific UTXO/EOA state.
      const balance = await publicClient.getBalance({ address: wallet.address as `0x${string}` });

      if (balance < MIN_SWEEP_THRESHOLD) {
        // Skip dusting amounts
        continue;
      }

      console.log(`Wallet ${wallet.address} has balance ${formatEther(balance)} ETH. Preparing sweep...`);

      // 3. Initialize the temporary signer for this specific user wallet
      const account = await walletService.getSignerForWallet(wallet.derivationIndex);

      // 4. Dynamic Gas Calculation (EIP-1559)
      // A standard native ETH transfer is exactly 21,000 gas.
      const gasLimit = 21000n;
      const feeData = await publicClient.estimateFeesPerGas();
      
      const maxFeePerGas = feeData.maxFeePerGas || 0n;
      const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas || 0n;

      // Calculate the maximum possible fee we might pay
      const maxGasCost = gasLimit * maxFeePerGas;
      
      // The amount we send is the total balance MINUS the gas fee
      const sweepAmount = balance - maxGasCost;

      if (sweepAmount <= 0n) {
          console.log(`Sweep amount too low after gas cost for ${wallet.address}. Skipping.`);
          continue;
      }

      console.log(`Sweeping ${formatEther(sweepAmount)} ETH to Hot Wallet...`);

      // 5. Initialize Wallet Client to execute the transaction
      const walletClient = createWalletClient({
        account,
        chain: baseSepolia,
        transport: http(process.env.RPC_URL || 'https://sepolia.base.org')
      });

      // 6. Broadcast Transaction
      const txHash = await walletClient.sendTransaction({
        to: HOT_WALLET_ADDRESS as `0x${string}`,
        value: sweepAmount,
        maxFeePerGas,
        maxPriorityFeePerGas,
        gas: gasLimit
      });

      console.log(`✅ Sweep transaction broadcasted: ${txHash}`);

      // 7. Record the intent in our database
      await prisma.transaction.create({
        data: {
          txHash,
          type: 'SWEEP',
          status: 'PENDING',
          toAddress: HOT_WALLET_ADDRESS,
          amount: sweepAmount.toString()
        }
      });

    } catch (error) {
      console.error(`❌ Error sweeping wallet ${wallet.address}:`, error);
    }
  }

  console.log('Sweeper Worker finished.');
}

// Execute the sweeper
sweep().then(() => process.exit(0)).catch(e => {
    console.error('Fatal Sweeper Error:', e);
    process.exit(1);
});