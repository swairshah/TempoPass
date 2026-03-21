import { createWalletClient, createPublicClient, http, formatUnits } from 'viem'
import { tempoModerato } from 'viem/chains'
import { Account, Secp256k1, tempoActions } from 'viem/tempo'

const PATHUSD = '0x20c0000000000000000000000000000000000000' as const

async function main() {
  const rootPk = Secp256k1.randomPrivateKey()
  const rootAccount = Account.fromSecp256k1(rootPk)
  console.log('Account:', rootAccount.address)

  const client = createWalletClient({
    account: rootAccount,
    chain: tempoModerato,
    transport: http(),
  }).extend(tempoActions())

  const publicClient = createPublicClient({
    chain: tempoModerato,
    transport: http(),
  }).extend(tempoActions())

  // Fund via faucet
  console.log('Requesting faucet...')
  const result = await client.faucet.fund({ account: rootAccount })
  console.log('Faucet result:', JSON.stringify(result, (k, v) => typeof v === 'bigint' ? v.toString() : v, 2))

  // Wait a bit
  await new Promise(r => setTimeout(r, 3000))

  // Check balance
  const balance = await publicClient.token.getBalance({
    token: PATHUSD,
    account: rootAccount.address,
  })
  console.log('pathUSD balance:', formatUnits(balance, 6))

  // Check native balance (for gas)
  const nativeBalance = await publicClient.getBalance({
    address: rootAccount.address,
  })
  console.log('Native balance (wei):', nativeBalance.toString())
}

main().catch(console.error)
