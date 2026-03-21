import { createPublicClient, http } from 'viem'
import { tempo } from 'viem/chains'
import { tempoActions } from 'viem/tempo'

async function main() {
  const client = createPublicClient({ chain: tempo, transport: http() }).extend(tempoActions())

  // Try USDC address
  const usdc = '0x20c000000000000000000000b9537d11c60e8b50' as const
  try {
    const meta = await client.token.getMetadata({ token: usdc })
    console.log('USDC metadata:', JSON.stringify(meta, (k,v) => typeof v === 'bigint' ? v.toString() : v))
  } catch(e: any) {
    console.log('USDC error:', e.message?.substring(0, 200))
  }

  // Also try some other known USDC-like addresses
  // TIP-20 tokens have sequential IDs, let's check a few
  for (const addr of [
    '0x20c0000000000000000000000000000000000001', // AlphaUSD
    '0x20c0000000000000000000000000000000000002', // BetaUSD
    '0x20c0000000000000000000000000000000000003', // ThetaUSD
  ]) {
    try {
      const meta = await client.token.getMetadata({ token: addr as any })
      console.log(`${addr}:`, meta.name, meta.symbol, meta.decimals.toString())
    } catch(e: any) {
      console.log(`${addr}: error`)
    }
  }
}
main()
