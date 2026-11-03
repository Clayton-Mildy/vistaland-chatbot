import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { MATERIAL_KINDS } from '../db/schema/index.js';
import { MONI_SETTABLE_STAGES } from '../leads/stages.js';
import { PARTS_OF_DAY } from '../scheduling/slots.js';

// Moni's tools. Inputs are validated with these zod schemas in our code (TOOL_INPUTS); the JSON
// schemas the model sees are written to match. Order is fixed so the prompt cache stays warm.

const project = z.string().min(1);
const int = z.number().int();
// WIB calendar date and wall-clock time; checked strictly because the slot code trusts them.
const date = z.iso.date();
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'format HH:MM');

export const TOOL_INPUTS = {
  search_units: z.object({
    project,
    bedrooms: int.min(1).max(10).optional(),
    max_price: int.positive().optional(),
    max_monthly: int.positive().optional(),
    sales_category: z.enum(['subsidi', 'komersil']).optional(),
  }),
  get_type_details: z.object({ project, house_type_id: int }),
  check_availability: z.object({ project, house_type_id: int, facing: z.string().min(1).optional() }),
  simulate_kpr: z.object({
    project,
    house_type_id: int,
    dp_pct: z.number().min(0).max(100).optional(),
    dp_amount: int.min(0).optional(),
    tenor_years: z.array(int.min(1).max(30)).max(5).optional(),
  }),
  send_materials: z.object({
    kind: z.enum(MATERIAL_KINDS),
    project,
    house_type_id: int.optional(),
    resend: z.boolean().optional(),
  }),
  update_lead: z.object({
    name: z.string().min(1).optional(),
    budget_price: int.positive().optional(),
    budget_monthly: int.positive().optional(),
    dp_budget: int.min(0).optional(),
    bedrooms_wanted: int.min(1).max(10).optional(),
    purpose: z.enum(['own_use', 'investment']).optional(),
    timeline: z.string().min(1).optional(),
    domicile_area: z.string().min(1).optional(),
    add_concerns: z.array(z.string().min(1)).optional(),
    add_type_interest: z.array(int).optional(),
    project: project.optional(),
    hot_cold: z.enum(['hot', 'warm', 'cold']).optional(),
    stage: z.enum(MONI_SETTABLE_STAGES).optional(),
    lost_reason: z.string().min(1).optional(),
  }),
  find_visit_slots: z.object({
    project,
    date_from: date,
    date_to: date.optional(),
    part_of_day: z.enum(PARTS_OF_DAY).optional(),
    time: time.optional(),
  }),
  book_visit: z.object({
    project,
    date,
    time,
    type_interest: z.array(int).optional(),
    topics: z.string().min(1).optional(),
  }),
  reschedule_visit: z.object({ date, time }),
  cancel_visit: z.object({ reason: z.string().min(1) }),
  handoff_to_human: z.object({ reason: z.string().min(1) }),
  opt_out: z.object({}),
  respond_to_customer: z.object({
    message: z.string(),
    no_reply: z.boolean().default(false),
    materials_position: z.enum(['before', 'after']).default('after'),
  }),
} as const;

export type ToolName = keyof typeof TOOL_INPUTS;

const projectProp = { type: 'string', description: 'Slug proyek, misalnya "zetira". Lihat blok PROYEK.' };
const dateProp = { type: 'string', description: 'Tanggal WIB "YYYY-MM-DD", dari baris KALENDER.' };
const timeProp = { type: 'string', description: 'Jam WIB "HH:MM", misalnya "10:00".' };
const typeProp = { type: 'integer', description: 'ID tipe rumah VLES (angka "id" di blok PROYEK atau hasil search_units).' };

const t = (name: ToolName, description: string, properties: Record<string, unknown>, required: string[] = []): Anthropic.Beta.BetaTool => ({
  name,
  description,
  input_schema: { type: 'object', properties, required, additionalProperties: false },
});

export const MONI_TOOLS: Anthropic.Beta.BetaTool[] = [
  t('search_units', 'Cari tipe rumah yang masih tersedia di proyek, disaring kamar tidur, harga maksimal, cicilan maksimal per bulan, atau kategori. Hasil memuat harga mulai, harga skema KPR, perkiraan cicilan, dan jumlah unit. Jika tidak ada yang cocok, hasil berisi dua pilihan termurah dengan nearest true.', {
    project: projectProp,
    bedrooms: { type: 'integer', description: 'Jumlah kamar tidur yang dicari.' },
    max_price: { type: 'integer', description: 'Harga rumah maksimal dalam rupiah.' },
    max_monthly: { type: 'integer', description: 'Cicilan maksimal per bulan dalam rupiah.' },
    sales_category: { type: 'string', enum: ['subsidi', 'komersil'] },
  }, ['project']),
  t('get_type_details', 'Detail satu tipe rumah: ukuran, kamar, keunggulan, skema pembayaran beserta harga dan DP, promo yang berlaku, dan jenis materi yang tersedia.', { project: projectProp, house_type_id: typeProp }, ['project', 'house_type_id']),
  t('check_availability', 'Cek langsung ke sistem VLES unit mana yang masih tersedia untuk satu tipe, opsional dengan arah hadap (misalnya "Timur"). Wajib dipanggil sebelum menyebut nomor unit atau posisi yang tersedia.', {
    project: projectProp,
    house_type_id: typeProp,
    facing: { type: 'string', description: 'Arah hadap, misalnya "Timur" atau "Barat Daya".' },
  }, ['project', 'house_type_id']),
  t('simulate_kpr', 'Simulasi cicilan KPR untuk satu tipe dengan harga skema KPR termurah. Tanpa DP dan tenor, pakai DP skema atau DP standar proyek dan semua pilihan tenor.', {
    project: projectProp,
    house_type_id: typeProp,
    dp_pct: { type: 'number', description: 'DP dalam persen, jika konsumen menyebutnya.' },
    dp_amount: { type: 'integer', description: 'DP dalam rupiah, jika konsumen menyebut nominal.' },
    tenor_years: { type: 'array', items: { type: 'integer' }, description: 'Tenor dalam tahun, jika konsumen menyebutnya.' },
  }, ['project', 'house_type_id']),
  t('send_materials', 'Kirim materi ke konsumen setelah balasan teks (atau sebelum, lihat materials_position). Materi yang sudah pernah dikirim dilewati kecuali resend true.', {
    kind: { type: 'string', enum: [...MATERIAL_KINDS], description: 'flyer, video, promo, floor_plan (denah), brochure (brosur), atau photo.' },
    project: projectProp,
    house_type_id: { ...typeProp, description: 'Isi untuk denah atau foto tipe tertentu.' },
    resend: { type: 'boolean', description: 'true hanya jika konsumen meminta dikirim ulang.' },
  }, ['kind', 'project']),
  t('update_lead', 'Simpan informasi konsumen dan tahap lead. Isi hanya kolom yang baru diketahui atau berubah.', {
    name: { type: 'string' },
    budget_price: { type: 'integer', description: 'Budget harga rumah, rupiah.' },
    budget_monthly: { type: 'integer', description: 'Cicilan per bulan yang nyaman, rupiah.' },
    dp_budget: { type: 'integer', description: 'Dana awal yang tersedia, rupiah.' },
    bedrooms_wanted: { type: 'integer' },
    purpose: { type: 'string', enum: ['own_use', 'investment'] },
    timeline: { type: 'string', description: 'Kapan ingin menempati, atau hari dan jam kunjungan yang diminta.' },
    domicile_area: { type: 'string', description: 'Area tempat tinggal atau beraktivitas konsumen.' },
    add_concerns: { type: 'array', items: { type: 'string' }, description: 'Keraguan baru, misalnya "lokasi jauh".' },
    add_type_interest: { type: 'array', items: { type: 'integer' }, description: 'ID tipe yang diminati.' },
    project: { ...projectProp, description: 'Slug proyek yang sedang dibahas, saat baru diketahui atau berganti.' },
    hot_cold: { type: 'string', enum: ['hot', 'warm', 'cold'] },
    stage: { type: 'string', enum: [...MONI_SETTABLE_STAGES] },
    lost_reason: { type: 'string' },
  }),
  t('find_visit_slots', 'Cari jam kunjungan yang masih kosong di proyek, paling jauh 14 hari dari date_from. Hasil: slots berisi date, time, dan label untuk ditawarkan. Jika kosong, hasil memuat reason dan message yang menjelaskan langkah berikutnya.', {
    project: projectProp,
    date_from: dateProp,
    date_to: { ...dateProp, description: 'Tanggal terakhir yang dicari, "YYYY-MM-DD". Default sama dengan date_from.' },
    part_of_day: { type: 'string', enum: [...PARTS_OF_DAY], description: 'Bagian hari yang diminta konsumen.' },
    time: { ...timeProp, description: 'Jam yang diminta konsumen, "HH:MM"; slot terdekat didahulukan.' },
  }, ['project', 'date_from']),
  t('book_visit', 'Jadwalkan kunjungan pada slot dari find_visit_slots, hanya setelah konsumen mengiyakan hari, jam, dan lokasinya. Hasil: label jadwal, nama sales pendamping, dan link Maps.', {
    project: projectProp,
    date: dateProp,
    time: timeProp,
    type_interest: { type: 'array', items: { type: 'integer' }, description: 'ID tipe yang ingin dilihat. Default: tipe yang diminati di STATUS LEAD.' },
    topics: { type: 'string', description: 'Hal yang ingin dibahas konsumen saat kunjungan, misalnya "simulasi KPR".' },
  }, ['project', 'date', 'time']),
  t('reschedule_visit', 'Pindahkan kunjungan aktif konsumen (lihat STATUS LEAD) ke slot lain dari find_visit_slots. Hasil sama seperti book_visit.', {
    date: dateProp,
    time: timeProp,
  }, ['date', 'time']),
  t('cancel_visit', 'Batalkan kunjungan aktif konsumen (lihat STATUS LEAD).', {
    reason: { type: 'string', description: 'Alasan pembatalan dari konsumen.' },
  }, ['reason']),
  t('handoff_to_human', 'Serahkan percakapan ke tim sales: Moni berhenti membalas sampai tim selesai. Tetap kirim pesan singkat ke konsumen lewat respond_to_customer.', {
    reason: { type: 'string', description: 'Alasan singkat, misalnya "minta nego harga" atau "minta ditelepon".' },
  }, ['reason']),
  t('opt_out', 'Catat bahwa konsumen tidak ingin dihubungi lagi. Tidak ada follow-up setelah ini.', {}),
  t('respond_to_customer', 'Balasan akhir untuk konsumen pada giliran ini. Wajib dipanggil tepat satu kali di setiap giliran.', {
    message: { type: 'string', description: 'Teks WhatsApp untuk konsumen. Kosong hanya jika no_reply true.' },
    no_reply: { type: 'boolean', description: 'true jika tidak perlu membalas apa pun.' },
    materials_position: { type: 'string', enum: ['before', 'after'], description: 'Materi yang diantre dikirim sebelum atau sesudah teks. Default after.' },
  }, ['message', 'no_reply']),
];
