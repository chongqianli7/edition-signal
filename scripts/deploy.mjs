import {existsSync, readFileSync, writeFileSync} from 'node:fs'
import {createAccount} from 'genlayer-js'
import {client, finalized, outcome} from '../network.js'

const destination = process.argv[2]
if (!destination || existsSync(destination)) throw Error('Specify a new deployment record path.')
if (await client.getChainId() !== 61999) throw Error('Expected Stable Studionet (61999).')
const hash = await client.deployContract({
  account:createAccount(),
  code:readFileSync(new URL('../contracts/edition_signal.py', import.meta.url), 'utf8'),
  args:[],
})
console.log(hash)
const receipt = await finalized(hash)
const deployment = {...outcome(receipt, hash), address:receipt.to_address, chainId:61999}
console.log(deployment)
if (deployment.status !== 'FINALIZED' || deployment.execution !== 'SUCCESS') process.exit(1)
writeFileSync(destination, JSON.stringify(deployment, null, 2) + '\n', {flag:'wx'})
