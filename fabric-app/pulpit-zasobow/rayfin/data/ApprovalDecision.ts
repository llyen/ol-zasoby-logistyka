import { entity, role, text, date, uuid } from '@microsoft/rayfin-core';

/**
 * Decyzja workflow: akceptacja, odrzucenie, prosba o informacje albo eskalacja.
 *
 * Decyzje sa niezmienne - kazda kolejna czynnosc to nowy wiersz. Brak akcji
 * 'update' i 'delete': historia sciezki gmina -> powiat -> wojewoda -> minister
 * -> RZZK musi dac sie odtworzyc co do kroku.
 */
@entity()
@role('authenticated', ['create', 'read'])
export class ApprovalDecision {
  @uuid() id!: string;
  @text({ min: 3, max: 40 }) decision_id!: string;
  /** Wniosek ze sceny (DEM...) albo z aplikacji (WN-...). */
  @text({ min: 3, max: 40 }) request_id!: string;
  @text({ min: 10, max: 10 }) scene_day!: string;
  /** 'akceptacja' | 'odrzucenie' | 'prosba_o_informacje' | 'eskalacja'. */
  @text({ min: 3, max: 30 }) decision!: string;
  /** Szczebel, na ktorym zapadla decyzja. */
  @text({ min: 3, max: 30 }) decision_level!: string;
  /** Szczebel docelowy przy eskalacji. */
  @text({ max: 30 }) escalated_to!: string;
  @text({ min: 10, max: 1200 }) reason!: string;
  @text({ max: 4 }) voivodeship_code!: string;
  @text({ max: 12 }) resource_type_id!: string;
  /** Migawka przeslanek (JSON) - co decydent widzial w chwili decyzji. */
  @text({ max: 2000 }) evidence!: string;
  @text({ max: 64 }) audit_hash!: string;
  @text({ max: 120 }) author_id!: string;
  @text({ max: 160 }) author_name!: string;
  @text({ min: 3, max: 40 }) author_role!: string;
  @date() created_at!: Date;
}
