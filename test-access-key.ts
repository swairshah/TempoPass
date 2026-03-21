/**
 * Tempo Access Key - TypeScript Proof of Concept
 *
 * This script demonstrates the full access key flow:
 * 1. Create a root account (simulating your passkey wallet)
 * 2. Generate a P256 access key (like what would live in a browser extension)
 * 3. Get testnet faucet funds
 * 4. Authorize the access key with expiry (10 hours) and spending limit ($10 pathUSD)
 * 5. Use the access key to send a token transfer (no root key needed!)
 * 6. Check remaining spending limit
 * 7. Verify key metadata (expiry, etc.)
 */

import { createWalletClient, createPublicClient, http, parseUnits, formatUnits } from 'viem'
import { tempoModerato } from 'viem/chains'
import { Account, Secp256k1, P256, tempoActions } from 'viem/tempo'

// ============ CONFIG ============
const EXPIRY_HOURS = 10 // Access key expires in 10 hours
const SPENDING_LIMIT_USD = 10 // $10 spending limit
const PATHUSD_TOKEN = '0x20c0000000000000000000000000000000000000' as const // pathUSD (6 decimals)

// A random recipient address for test transfers
const RECIPIENT = '0x000000000000000000000000000000000000dEaD' as const

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

async function main() {
  console.log('🎵 Tempo Access Key - TypeScript PoC')
  console.log('====================================\n')

  // ── Step 1: Create the root account (simulates your Tempo wallet passkey) ──
  const rootPrivateKey = Secp256k1.randomPrivateKey()
  const rootAccount = Account.fromSecp256k1(rootPrivateKey)
  console.log('✅ Root account created:', rootAccount.address)
  console.log('   Key type:', rootAccount.keyType)

  // ── Step 2: Generate a P256 access key (this would live in the extension) ──
  const accessKeyPrivateKey = P256.randomPrivateKey()
  const accessKey = Account.fromP256(accessKeyPrivateKey, {
    access: rootAccount,
  })
  console.log('\n✅ P256 Access key generated:')
  console.log('   Access key ID:', accessKey.accessKeyAddress)
  console.log('   Acts on behalf of:', accessKey.address, '(same as root!)')
  console.log('   Key type:', accessKey.keyType)

  // ── Step 3: Set up Viem clients with Tempo extensions ──
  const rootClient = createWalletClient({
    account: rootAccount,
    chain: tempoModerato,
    transport: http(),
  }).extend(tempoActions())

  const publicClient = createPublicClient({
    chain: tempoModerato,
    transport: http(),
  }).extend(tempoActions())

  // ── Step 4: Get testnet faucet funds ──
  console.log('\n⏳ Requesting testnet faucet funds...')
  try {
    const faucetHashes = await rootClient.faucet.fund({
      account: rootAccount,
    })
    console.log('✅ Faucet request sent! Tx hashes:', faucetHashes)
    
    // Wait for faucet transactions to be confirmed
    console.log('   Waiting for faucet confirmation...')
    await sleep(3000)
  } catch (err: any) {
    console.log('⚠️  Faucet error:', err.message?.substring(0, 100))
  }

  // Check balance
  const balance = await publicClient.token.getBalance({
    token: PATHUSD_TOKEN,
    account: rootAccount.address,
  })
  console.log('   pathUSD balance:', formatUnits(balance, 6))

  if (balance === 0n) {
    console.error('❌ No funds received. Cannot proceed.')
    return
  }

  // ── Step 5: Authorize the access key with expiry + spending limit ──
  const expiryTimestamp = Math.floor(Date.now() / 1000) + EXPIRY_HOURS * 3600
  const spendingLimitRaw = parseUnits(SPENDING_LIMIT_USD.toString(), 6)

  console.log('\n⏳ Authorizing access key...')
  console.log('   Expiry:', new Date(expiryTimestamp * 1000).toISOString())
  console.log('   Spending limit:', formatUnits(spendingLimitRaw, 6), 'pathUSD')

  const authResult = await rootClient.accessKey.authorizeSync({
    accessKey,
    expiry: expiryTimestamp,
    limits: [
      { token: PATHUSD_TOKEN, limit: spendingLimitRaw },
    ],
  })
  console.log('✅ Access key authorized!')
  console.log('   Tx hash:', authResult.receipt.transactionHash)
  console.log('   Public key:', authResult.publicKey)
  console.log('   Expiry:', authResult.expiry.toString())

  // ── Step 6: Verify key metadata ──
  console.log('\n⏳ Checking access key metadata...')
  const metadata = await publicClient.accessKey.getMetadata({
    account: rootAccount.address,
    accessKey: accessKey.accessKeyAddress,
  })
  console.log('✅ Access key metadata:')
  console.log('   Key type:', metadata.keyType)
  console.log('   Spend policy:', metadata.spendPolicy)
  console.log('   Is revoked:', metadata.isRevoked)
  console.log('   Expiry:', new Date(Number(metadata.expiry) * 1000).toISOString())

  // ── Step 7: Check remaining spending limit ──
  console.log('\n⏳ Checking remaining spending limit...')
  const remainingBefore = await publicClient.accessKey.getRemainingLimit({
    account: rootAccount.address,
    accessKey: accessKey.accessKeyAddress,
    token: PATHUSD_TOKEN,
  })
  console.log('✅ Remaining limit:', formatUnits(remainingBefore, 6), 'pathUSD')

  // ── Step 8: USE the access key to send a transfer (no root key needed!) ──
  console.log('\n⏳ Sending transfer with ACCESS KEY (no passkey/root key needed!)...')
  console.log('   Transferring 1 pathUSD to', RECIPIENT)

  const accessKeyClient = createWalletClient({
    account: accessKey,
    chain: tempoModerato,
    transport: http(),
  }).extend(tempoActions())

  const transferResult = await accessKeyClient.token.transferSync({
    token: PATHUSD_TOKEN,
    to: RECIPIENT,
    amount: parseUnits('1', 6),
  })
  console.log('✅ Transfer successful with access key!')
  console.log('   Tx hash:', transferResult.receipt.transactionHash)
  console.log('   From:', transferResult.from)
  console.log('   To:', transferResult.to)
  console.log('   Amount:', formatUnits(transferResult.amount, 6), 'pathUSD')

  // ── Step 9: Check remaining limit after transfer ──
  console.log('\n⏳ Checking remaining limit after transfer...')
  const remainingAfter = await publicClient.accessKey.getRemainingLimit({
    account: rootAccount.address,
    accessKey: accessKey.accessKeyAddress,
    token: PATHUSD_TOKEN,
  })
  console.log('✅ Remaining limit:', formatUnits(remainingAfter, 6), 'pathUSD')
  console.log('   (Started with', SPENDING_LIMIT_USD, '→ spent 1 → remaining', formatUnits(remainingAfter, 6), ')')

  // ── Summary ──
  console.log('\n====================================')
  console.log('📋 PROOF OF CONCEPT COMPLETE!')
  console.log('')
  console.log('   Root account:', rootAccount.address)
  console.log('   Access key:', accessKey.accessKeyAddress)
  console.log('   Expiry:', new Date(expiryTimestamp * 1000).toLocaleString())
  console.log('   Spending limit:', SPENDING_LIMIT_USD, 'pathUSD')
  console.log('')
  console.log('   ✅ The access key signed a transfer WITHOUT the root key!')
  console.log('   ✅ The protocol enforces expiry + spending limits on-chain!')
  console.log('   ✅ Ready to build the browser extension!')
  console.log('====================================')
}

main().catch(err => {
  console.error('❌ Fatal error:', err.message)
  console.error(err)
  process.exit(1)
})
