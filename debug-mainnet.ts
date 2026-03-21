import { createPublicClient, http, formatUnits, formatEther } from 'viem'
import { tempo } from 'viem/chains'
import { tempoActions } from 'viem/tempo'

async function main() {
  const client = createPublicClient({ chain: tempo, transport: http() }).extend(tempoActions())
  
  const addr = '0xE5aA3b69f9A7' as const // partial - need full
  
  // Let's get chain info first
  console.log('Chain:', tempo.name, 'ID:', tempo.id)
  console.log('Native currency:', JSON.stringify(tempo.nativeCurrency))
  console.log('RPC:', tempo.rpcUrls.default.http[0])
  
  // We need the full address. Let's derive it from the public key we found
  const { Account } = await import('viem/tempo')
  const pubKey = '0x04a38dd42f9caebfb3d2a96ba3f2e380b298295ad1b5d08514395676f34168ff30917774cde8cf56d8b4438cb4d31e3e9ad9b95892e374247c6ee8837886dbd222' as const
  const credId = 'rC2LNTqug-eSVdCi85FzMA'
  
  const account = Account.fromWebAuthnP256(
    { id: credId, publicKey: pubKey },
    { rpId: 'tempo.xyz' }
  )
  
  console.log('\nFull address:', account.address)
  
  // Check native balance (ETH-equivalent)
  const nativeBal = await client.getBalance({ address: account.address })
  console.log('Native balance (wei):', nativeBal.toString())
  console.log('Native balance (ether):', formatEther(nativeBal))
  
  // Check USDC balance
  const usdcBal = await client.token.getBalance({
    token: '0x20c000000000000000000000b9537d11c60e8b50',
    account: account.address,
  })
  console.log('USDC balance:', formatUnits(usdcBal, 6))
  
  // Check pathUSD balance  
  const pathBal = await client.token.getBalance({
    token: '0x20c0000000000000000000000000000000000000',
    account: account.address,
  })
  console.log('pathUSD balance:', formatUnits(pathBal, 6))

  // Check gas price
  const gasPrice = await client.getGasPrice()
  console.log('Gas price (wei):', gasPrice.toString())
  console.log('Gas price (gwei):', formatUnits(gasPrice, 9))

  // Estimate a simple authorize call gas
  console.log('\n--- Estimating authorize gas ---')
  // Try to estimate a simple transaction
  try {
    const est = await client.estimateGas({
      account: account.address,
      to: account.address,
      value: 0n,
    })
    console.log('Simple tx gas estimate:', est.toString())
    console.log('Estimated cost:', formatEther(est * gasPrice))
  } catch(e: any) {
    console.log('Gas estimate error:', e.shortMessage || e.message?.substring(0, 300))
  }
}

main().catch(console.error)
