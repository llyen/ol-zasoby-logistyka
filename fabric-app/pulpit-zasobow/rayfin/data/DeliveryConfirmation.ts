import { entity, role, text, int, decimal, date, uuid } from '@microsoft/rayfin-core';

/**
 * Potwierdzenie odbioru dostawy przez gmine albo punkt przyjecia.
 *
 * Zamyka petle: wniosek -> przydzial -> transport -> odbior. Niedobor
 * (received_qty < allocated_qty) jest zapisywany razem z przyczyna, bo to on
 * generuje ponowne zapotrzebowanie.
 */
@entity()
@role('authenticated', ['create', 'read'])
export class DeliveryConfirmation {
  @uuid() id!: string;
  @text({ min: 3, max: 40 }) confirmation_id!: string;
  @text({ min: 3, max: 40 }) transport_id!: string;
  @text({ max: 40 }) allocation_id!: string;
  @text({ min: 10, max: 10 }) scene_day!: string;
  @text({ max: 12 }) gmina_code!: string;
  @text({ max: 12 }) resource_type_id!: string;
  @int() allocated_qty!: number;
  @int() received_qty!: number;
  /** Wymagana, gdy received_qty < allocated_qty. */
  @text({ max: 600 }) shortage_reason!: string;
  /** Opoznienie wzgledem ETA w minutach. */
  @int() delay_min!: number;
  @text({ max: 160 }) receiver_name!: string;
  /** Skrot podpisu demo - nie jest podpisem kwalifikowanym. */
  @text({ max: 64 }) signature_hash!: string;
  @decimal() lat!: number;
  @decimal() lon!: number;
  @text({ max: 120 }) author_id!: string;
  @text({ max: 160 }) author_name!: string;
  @text({ min: 3, max: 40 }) author_role!: string;
  @date() created_at!: Date;
}
