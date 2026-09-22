import type IDatagram from "../interfaces/net/IDatagram";
import type ISocket from "../interfaces/net/ISocket";
import type { Edict } from "./Edict";
import type { V3 } from "./Vector";

export type Client = {
	num: number
	name: string
	message: IDatagram
	colors: number;
	old_frags: number;
	active: boolean;
	spawn_parms: number[];
	netconnection?: ISocket;
	dropasap: boolean;
	last_message?: number;
	cmd: {
		forwardmove: number;
		sidemove: number;
		upmove: number;
	}
	wishdir: V3;
	edict?: Edict;
	ping_times?: number[];
	num_pings?: number;
  spawned: boolean;
  reconnect: boolean;
  sendsignon: boolean;
  // FTE protocol-extension negotiation (QSS server.h:173-175). pextknown releases the
  // deferred serverinfo: the client answered `cmd pext`, or never would.
  pextknown: boolean;
  protocol_pext1: number;
  protocol_pext2: number;
  // CSQC entity stream (QSS server.h:190-194, 234). Bits are accumulated .SendFlags plus
  // SENDFLAG_PRESENT/REMOVE; allocated and grown lazily by the datagram builder.
  csqcactive: boolean;
  pendingcsqcentities_bits: Uint32Array | null;
  // Last stat values sent, so only changes are emitted (QSS server.h:178-180). Dropped at
  // serverinfo/connect so the next map resends everything. Float32Array so the comparison
  // happens at wire precision - otherwise discarded mantissa bits resend every frame.
  oldstats_i: Int32Array | null;
  oldstats_f: Float32Array | null;
  oldstats_s: (string | null)[] | null;
  // spam protection
  lastspoke: number;
  floodprotmessage: number;
  lockedtill: number
}