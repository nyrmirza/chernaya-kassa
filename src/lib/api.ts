import { supabase } from './supabase';

export type SeatKind = 'pair' | 'single';
export type KassaStatus = 'open' | 'drawn' | 'finished';

export interface Seat {
  id: string;
  name: string;
  kind: SeatKind;
  position: number | null;
  members: number;
  /** Имена: [одиночка] или [первый, второй] для пары. null у старых мест. */
  names: string[] | null;
  /** Кто из пары уже в приложении: 0 — первый, 1 — второй. */
  joined: number[];
  is_owner: boolean;
}

/** Без `method` — значит «сдал», подробности скрыты (так другие видят тихий долг). */
export interface Payment {
  seat_id: string;
  method?: 'cash' | 'kaspi';
  amount?: number;
  received?: boolean;
}

export interface Meeting {
  id: string;
  idx: number;
  month: string; // YYYY-MM-01
  holder_seat_id: string | null;
  meet_date: string | null;
  meet_time: string | null;
  place: string;
  bill: number;
  bill_split: 'person' | 'seat';
  bill_people: number | null;
  holder_name: string | null;
  closed: boolean;
  can_manage: boolean;
  payments: Payment[];
}

export interface KassaState {
  kassa: {
    id: string;
    code: string;
    title: string;
    share_pair: number;
    share_single: number;
    start_month: string;
    round: number;
    status: KassaStatus;
    is_owner: boolean;
    target_size: number | null;
  };
  my_seat_id: string;
  my_person_idx: number;
  seats: Seat[];
  reclaims: ReclaimRequest[];
  meetings: Meeting[];
  secret_debts: { meeting_id: string; month: string; seat_id: string; seat_name: string; amount: number }[];
  my_debts: { meeting_id: string; month: string; holder_name: string | null; amount: number }[];
  swaps: SwapRequest[];
  polls: Poll[];
  history: { round: number; meetings: HistoryMeeting[] }[];
}

export interface ReclaimRequest {
  id: string;
  seat_id: string;
  seat_name: string;
  person_name: string;
  created_at: string;
}

export interface PartnerPreview {
  kassa_id: string;
  title: string;
  seat_name: string;
  my_name: string;
  partner_name: string;
  already_member: boolean;
  full: boolean;
}

export interface SwapRequest {
  id: string;
  from_seat: string;
  to_seat: string;
  from_name: string;
  to_name: string;
  created_at: string;
}

export interface PollOption {
  id: string;
  text: string;
  votes: number;
  mine: boolean;
  names: string[];
}

export interface Poll {
  id: string;
  question: string;
  multi: boolean;
  closed: boolean;
  created_at: string;
  author: string | null;
  can_manage: boolean;
  voters: number;
  options: PollOption[];
}

export interface HistoryMeeting {
  month: string;
  holder_name: string | null;
  meet_date: string | null;
  place: string;
  bill: number;
  collected: number;
  closed: boolean;
}

export interface KassaListItem {
  id: string;
  title: string;
  code: string;
  status: KassaStatus;
  seats: number;
  is_owner: boolean;
  current_month: string | null;
  current_holder: string | null;
  target_size: number | null;
  pending_swaps: number;
  pending_reclaims: number;
}

export interface KassaPreview {
  id: string;
  title: string;
  status: KassaStatus;
  share_pair: number;
  share_single: number;
  already_member: boolean;
  target_size: number | null;
  seat_count: number;
  pending_reclaim: boolean;
  seats: { id: string; name: string; kind: SeatKind; names: string[] | null; members: number }[];
}

/** Ошибка сервера с кодом вроде NAME_TAKEN — для перевода в i18n (err.NAME_TAKEN). */
export class ApiError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

const KNOWN = /\b([A-Z][A-Z0-9_]{3,})\b/;

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    const m = (error.message || '').match(KNOWN);
    throw new ApiError(m ? m[1] : 'NETWORK');
  }
  return data as T;
}

export const api = {
  myKassas: () => rpc<KassaListItem[]>('my_kassas'),
  getKassa: (id: string) => rpc<KassaState>('get_kassa', { p_kassa: id }),
  createKassa: (p: { title: string; name: string; names: string[]; kind: SeatKind; sharePair: number; shareSingle: number; start?: string; size: number }) =>
    rpc<string>('create_kassa', {
      p_title: p.title,
      p_seat_name: p.name,
      p_kind: p.kind,
      p_share_pair: p.sharePair,
      p_share_single: p.shareSingle,
      p_start: p.start ?? null,
      p_size: p.size,
      p_names: p.names,
    }),
  preview: (code: string) => rpc<KassaPreview>('kassa_preview', { p_code: code }),
  join: (code: string, p: { name?: string; names?: string[]; kind?: SeatKind; seatId?: string }) =>
    rpc<string>('join_kassa', {
      p_code: code,
      p_name: p.name ?? null,
      p_kind: p.kind ?? null,
      p_seat: p.seatId ?? null,
      p_names: p.names ?? null,
    }),
  partnerInvite: (kassaId: string) => rpc<string>('partner_invite', { p_kassa: kassaId }),
  partnerPreview: (token: string) => rpc<PartnerPreview>('partner_preview', { p_token: token }),
  joinPartner: (token: string) => rpc<string>('join_partner', { p_token: token }),
  requestReclaim: (code: string, seatId: string, person: number) =>
    rpc<string>('request_reclaim', { p_code: code, p_seat: seatId, p_person: person }),
  respondReclaim: (req: string, accept: boolean) => rpc<void>('respond_reclaim', { p_request: req, p_accept: accept }),
  cancelReclaim: (req: string) => rpc<void>('cancel_reclaim', { p_request: req }),
  myReclaims: () => rpc<{ id: string; kassa_title: string; seat_name: string; created_at: string }[]>('my_reclaims'),
  leave: (id: string) => rpc<void>('leave_kassa', { p_kassa: id }),
  updateKassa: (id: string, p: { title: string; sharePair: number; shareSingle: number; start: string | null; size?: number | null }) =>
    rpc<void>('update_kassa', {
      p_kassa: id,
      p_title: p.title,
      p_share_pair: p.sharePair,
      p_share_single: p.shareSingle,
      p_start: p.start,
      p_size: p.size ?? null,
    }),
  addSeat: (id: string, name: string, kind: SeatKind, names: string[]) =>
    rpc<string>('add_seat', { p_kassa: id, p_name: name, p_kind: kind, p_names: names }),
  transferOwner: (id: string, seatId: string, person: number) =>
    rpc<void>('transfer_owner', { p_kassa: id, p_seat: seatId, p_person: person }),
  deleteKassa: (id: string) => rpc<void>('delete_kassa', { p_kassa: id }),
  removeSeat: (id: string, seatId: string) => rpc<void>('remove_seat', { p_kassa: id, p_seat: seatId }),
  draw: (id: string) => rpc<void>('draw_kassa', { p_kassa: id }),
  resetDraw: (id: string) => rpc<void>('reset_draw', { p_kassa: id }),
  newRound: (id: string) => rpc<void>('new_round', { p_kassa: id }),
  updateMeeting: (
    m: string,
    p: { date: string | null; time: string | null; place: string; bill: number; split?: 'person' | 'seat'; people?: number | null },
  ) =>
    rpc<void>('update_meeting', {
      p_meeting: m,
      p_date: p.date,
      p_time: p.time,
      p_place: p.place,
      p_bill: p.bill,
      p_split: p.split ?? null,
      p_people: p.people ?? null,
    }),
  swapQueue: (id: string, a: string, b: string) => rpc<void>('swap_queue', { p_kassa: id, p_seat_a: a, p_seat_b: b }),
  requestSwap: (id: string, toSeat: string) => rpc<string>('request_swap', { p_kassa: id, p_to_seat: toSeat }),
  respondSwap: (req: string, accept: boolean) => rpc<void>('respond_swap', { p_request: req, p_accept: accept }),
  cancelSwap: (req: string) => rpc<void>('cancel_swap', { p_request: req }),
  createPoll: (id: string, question: string, options: string[], multi: boolean) =>
    rpc<string>('create_poll', { p_kassa: id, p_question: question, p_options: options, p_multi: multi }),
  votePoll: (poll: string, options: string[]) => rpc<void>('vote_poll', { p_poll: poll, p_options: options }),
  closePoll: (poll: string) => rpc<void>('close_poll', { p_poll: poll }),
  deletePoll: (poll: string) => rpc<void>('delete_poll', { p_poll: poll }),
  markPayment: (m: string, seatId: string, method: 'cash' | 'kaspi' | null) =>
    rpc<void>('mark_payment', { p_meeting: m, p_seat: seatId, p_method: method }),
  confirmKaspi: (m: string, seatId: string) => rpc<void>('confirm_kaspi', { p_meeting: m, p_seat: seatId }),
  closeMeeting: (m: string) => rpc<void>('close_meeting', { p_meeting: m }),
  deleteAccount: () => rpc<void>('delete_my_account'),
  /** Своя демо-касса с примерами; старая демо-касса пользователя заменяется. */
  registerPush: (token: string, lang: string) => rpc<void>('register_push', { p_token: token, p_lang: lang }),
  startDemo: (lang: string) =>
    // Новая версия сервера создаёт демо на языке приложения; если её ещё нет — старая (по-русски).
    rpc<string>('start_demo', { p_lang: lang }).catch(() => rpc<string>('start_demo')),
};
