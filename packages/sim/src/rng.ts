/** xorshift32: small, fast and identical on every JavaScript engine. */
export class Rng {
	state: number

	constructor(seed: number) {
		this.state = seed >>> 0 || 0x9e3779b9
	}

	/** uniform in [0, 1) */
	next(): number {
		let x = this.state
		x ^= x << 13
		x >>>= 0
		x ^= x >>> 17
		x ^= x << 5
		x >>>= 0
		this.state = x
		return x / 4294967296
	}

	/** integer in [0, max) */
	int(max: number): number {
		return Math.floor(this.next() * max)
	}
}
