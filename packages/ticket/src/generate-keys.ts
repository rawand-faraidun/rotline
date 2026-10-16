// Prints new Ed25519 key pairs as .env lines: game tickets (API signs, game servers verify) and
// reward reports (game servers sign, the API verifies).
import { generateKeyPairSync } from 'node:crypto'

const der = (key: { export: (options: { format: 'der'; type: 'pkcs8' | 'spki' }) => Buffer }, type: 'pkcs8' | 'spki') =>
	key.export({ format: 'der', type }).toString('base64')

for (const name of ['GAME_TICKET', 'GAME_REWARD']) {
	const { privateKey, publicKey } = generateKeyPairSync('ed25519')
	process.stdout.write(
		`${name}_PRIVATE_KEY=${der(privateKey, 'pkcs8')}\n${name}_PUBLIC_KEY=${der(publicKey, 'spki')}\n`
	)
}
