import { entity, role, text, date, uuid } from '@microsoft/rayfin-core';

/**
 * Uruchomienie rezerw strategicznych albo zamowienie u dostawcy ramowego
 * (Ekran „Czy wystarczy?”).
 *
 * Powstaje z prognozy wyczerpania zapasu, dlatego zapisujemy stan prognozy
 * w chwili decyzji - inaczej po odswiezeniu danych nie da sie ocenic, czy
 * decyzja byla uzasadniona.
 */
@entity()
@role('authenticated', ['create', 'read'])
export class SupplyAction {
  @uuid() id!: string;
  @text({ min: 3, max: 40 }) action_id!: string;
  @text({ min: 10, max: 10 }) scene_day!: string;
  /** 'rezerwy_strategiczne' | 'dostawca_ramowy' | 'przerzut_miedzywojewodzki'. */
  @text({ min: 3, max: 40 }) action_type!: string;
  @text({ max: 4 }) voivodeship_code!: string;
  @text({ min: 2, max: 12 }) resource_type_id!: string;
  @text({ max: 80 }) resource_name!: string;
  /** Dni zapasu w chwili decyzji - migawka prognozy. */
  @text({ max: 20 }) days_of_stock!: string;
  @text({ max: 20 }) daily_rate!: string;
  @text({ max: 12 }) supplier_id!: string;
  @text({ max: 20 }) lead_time_h!: string;
  @text({ max: 20 }) quantity!: string;
  @text({ min: 20, max: 1200 }) comment!: string;
  @text({ max: 64 }) audit_hash!: string;
  @text({ max: 120 }) author_id!: string;
  @text({ max: 160 }) author_name!: string;
  @text({ min: 3, max: 40 }) author_role!: string;
  @date() created_at!: Date;
}
