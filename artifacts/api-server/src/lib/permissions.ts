import { ChatInputCommandInteraction, PermissionFlagsBits } from "discord.js";
import { db, OWNER_ID } from "./db";

export function isOwner(userId: string): boolean {
  return userId === OWNER_ID;
}

export function isBotAdmin(userId: string): boolean {
  if (isOwner(userId)) return true;
  const row = db.prepare("SELECT 1 FROM admins_bot WHERE user_id = ?").get(userId);
  return !!row;
}

export function addBotAdmin(userId: string, addedBy: string): void {
  db.prepare(`
    INSERT INTO admins_bot (user_id, adicionado_em, adicionado_por)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO NOTHING
  `).run(userId, Date.now(), addedBy);
}

export function removeBotAdmin(userId: string): boolean {
  if (userId === OWNER_ID) return false;
  const result = db.prepare("DELETE FROM admins_bot WHERE user_id = ?").run(userId);
  return result.changes > 0;
}

export function listBotAdmins(): { user_id: string; adicionado_em: number }[] {
  return db.prepare("SELECT user_id, adicionado_em FROM admins_bot ORDER BY adicionado_em").all() as any[];
}

/** Verifica se o usuário tem permissão de Administrador no servidor Discord */
export function isServerAdmin(interaction: ChatInputCommandInteraction): boolean {
  if (!interaction.guild || !interaction.memberPermissions) return false;
  return (
    interaction.memberPermissions.has(PermissionFlagsBits.Administrator) ||
    interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)
  );
}
