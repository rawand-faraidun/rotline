/** Growable little-endian binary writer. One per connection, reused for every message. */
export class Writer {
	private bytes: Uint8Array<ArrayBuffer>
	private view: DataView
	offset = 0

	constructor(capacity = 4096) {
		this.bytes = new Uint8Array(capacity)
		this.view = new DataView(this.bytes.buffer)
	}

	reset(): this {
		this.offset = 0
		return this
	}

	private ensure(extra: number): void {
		if (this.offset + extra <= this.bytes.length) return
		let size = this.bytes.length * 2
		while (size < this.offset + extra) size *= 2
		const next = new Uint8Array(size)
		next.set(this.bytes.subarray(0, this.offset))
		this.bytes = next
		this.view = new DataView(next.buffer)
	}

	u8(value: number): this {
		this.ensure(1)
		this.view.setUint8(this.offset, value)
		this.offset += 1
		return this
	}

	i8(value: number): this {
		this.ensure(1)
		this.view.setInt8(this.offset, value)
		this.offset += 1
		return this
	}

	u16(value: number): this {
		this.ensure(2)
		this.view.setUint16(this.offset, value, true)
		this.offset += 2
		return this
	}

	i16(value: number): this {
		this.ensure(2)
		this.view.setInt16(this.offset, value, true)
		this.offset += 2
		return this
	}

	u32(value: number): this {
		this.ensure(4)
		this.view.setUint32(this.offset, value, true)
		this.offset += 4
		return this
	}

	f32(value: number): this {
		this.ensure(4)
		this.view.setFloat32(this.offset, value, true)
		this.offset += 4
		return this
	}

	f64(value: number): this {
		this.ensure(8)
		this.view.setFloat64(this.offset, value, true)
		this.offset += 8
		return this
	}

	varint(value: number): this {
		let v = value >>> 0
		while (v >= 0x80) {
			this.u8((v & 0x7f) | 0x80)
			v >>>= 7
		}
		return this.u8(v)
	}

	string(value: string): this {
		const encoded = new TextEncoder().encode(value)
		this.varint(encoded.length)
		this.ensure(encoded.length)
		this.bytes.set(encoded, this.offset)
		this.offset += encoded.length
		return this
	}

	/** Overwrites a byte already written (for flags decided after the fields). */
	patchU8(at: number, value: number): void {
		this.view.setUint8(at, value)
	}

	/** A view of the bytes written so far; valid until the next write. */
	view8(): Uint8Array<ArrayBuffer> {
		return this.bytes.subarray(0, this.offset)
	}

	/** A copy of the bytes written so far. */
	finish(): Uint8Array<ArrayBuffer> {
		return this.bytes.slice(0, this.offset)
	}
}

export class ProtocolError extends Error {}

/** Bounds-checked binary reader; any malformed message throws ProtocolError. */
export class Reader {
	private readonly view: DataView
	offset = 0

	constructor(bytes: Uint8Array | ArrayBuffer) {
		const array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
		this.view = new DataView(array.buffer, array.byteOffset, array.byteLength)
	}

	get remaining(): number {
		return this.view.byteLength - this.offset
	}

	private need(size: number): void {
		if (this.offset + size > this.view.byteLength) throw new ProtocolError('message too short')
	}

	u8(): number {
		this.need(1)
		return this.view.getUint8(this.offset++)
	}

	i8(): number {
		this.need(1)
		return this.view.getInt8(this.offset++)
	}

	u16(): number {
		this.need(2)
		const value = this.view.getUint16(this.offset, true)
		this.offset += 2
		return value
	}

	i16(): number {
		this.need(2)
		const value = this.view.getInt16(this.offset, true)
		this.offset += 2
		return value
	}

	u32(): number {
		this.need(4)
		const value = this.view.getUint32(this.offset, true)
		this.offset += 4
		return value
	}

	f32(): number {
		this.need(4)
		const value = this.view.getFloat32(this.offset, true)
		this.offset += 4
		return value
	}

	f64(): number {
		this.need(8)
		const value = this.view.getFloat64(this.offset, true)
		this.offset += 8
		return value
	}

	varint(): number {
		let result = 0
		let shift = 0
		for (;;) {
			const byte = this.u8()
			result |= (byte & 0x7f) << shift
			if ((byte & 0x80) === 0) return result >>> 0
			shift += 7
			if (shift > 28) throw new ProtocolError('varint too long')
		}
	}

	string(maxLength = 4096): string {
		const length = this.varint()
		if (length > maxLength) throw new ProtocolError('string too long')
		this.need(length)
		const bytes = new Uint8Array(this.view.buffer, this.view.byteOffset + this.offset, length)
		this.offset += length
		return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
	}
}
