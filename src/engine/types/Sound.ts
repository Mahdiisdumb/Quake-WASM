import { V3 } from "./Vector"

export type SoundCache = {
    loopstart: number
    length: number
    size: number
    data: AudioBuffer
}

export type Sound = {
    name: string,
    cache: SoundCache
    data: ArrayBuffer,
    type: string
    loading?: Promise<boolean>
    // memoized load/parse failure — cleared on flushCache, so one attempt per map
    failed?: boolean
}

export type Nodes = {
    state: 'end' | 'playing' | 'idle',
	source: AudioBufferSourceNode,
	// ambient path: one centered gain; positional path: per-ear gains into a merger
	gain: GainNode,
	gainL: GainNode,
	gainR: GainNode,
	merger: ChannelMergerNode,
	// whether the output reaches masterGain — statics detach while inaudible
	connected: boolean
}

export type Channel = {
	sfx: Sound,
	end: number,
    pos: number
	master_vol: number
    leftvol: number
    rightvol: number
	nodes: Nodes
    entnum: number
    entchannel: number
    dist_mult: number
    origin: V3
}
