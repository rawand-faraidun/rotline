// Prints a new Ed25519 key pair for game tickets, as .env lines.
import { generateKeyPairSync } from 'node:crypto'

const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const der = (key: { export: (options: { format: 'der'; type: 'pkcs8' | 'spki' }) => Buffer }, type: 'pkcs8' | 'spki') =>
	key.export({ format: 'der', type }).toString('base64')

process.stdout.write(
	`GAME_TICKET_PRIVATE_KEY=${der(privateKey, 'pkcs8')}\nGAME_TICKET_PUBLIC_KEY=${der(publicKey, 'spki')}\n`
)
