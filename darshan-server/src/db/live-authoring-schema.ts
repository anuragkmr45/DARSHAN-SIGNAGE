import { pgTable, uuid, integer, varchar, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { users, schedules, scheduleRequests } from './schema';

export const liveAuthoringDrafts = pgTable('live_authoring_drafts', {
  id: uuid('id').primaryKey(), schedule_id: uuid('schedule_id').unique().references(() => schedules.id, { onDelete: 'set null' }),
  created_by: uuid('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  revision: integer('revision').notNull(), last_request_id: uuid('last_request_id').notNull(),
  last_request_fingerprint: varchar('last_request_fingerprint', { length: 64 }).notNull(), last_review: jsonb('last_review').notNull(),
  submission_request_id: uuid('submission_request_id'), submission_fingerprint: varchar('submission_fingerprint', { length: 64 }),
  submitted_request_id: uuid('submitted_request_id').references(() => scheduleRequests.id, { onDelete: 'restrict' }),
  created_at: timestamp('created_at').notNull().defaultNow(), updated_at: timestamp('updated_at').notNull().defaultNow(),
});
