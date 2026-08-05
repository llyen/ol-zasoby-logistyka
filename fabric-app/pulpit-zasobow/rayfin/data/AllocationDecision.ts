import { entity, role, text, int, decimal, date, uuid } from '@microsoft/rayfin-core';

/**
 * Zatwierdzenie planu przydzialu albo recznej korekty (Ekran „Plan przydzialu”).
 *
 * Kluczowy slad audytowy demo: gdy operator odchodzi od rekomendacji optymalizatora,
 * zapisujemy oba warianty i roznice czasu dojazdu. Bez tego nie da sie pozniej
 * odpowiedziec, ile kosztowala decyzja reczna.
 */
@entity()
@role('authenticated', ['create', 'read'])
export class AllocationDecision {
  @uuid() id!: string;
  @text({ min: 3, max: 40 }) allocation_decision_id!: string;
  @text({ min: 3, max: 40 }) demand_id!: string;
  @text({ min: 10, max: 10 }) scene_day!: string;
  /** Magazyn wskazany przez optymalizator. */
  @text({ max: 12 }) recommended_warehouse_id!: string;
  @decimal() recommended_travel_h!: number;
  /** Magazyn faktycznie wybrany przez operatora. */
  @text({ min: 2, max: 12 }) chosen_warehouse_id!: string;
  @decimal() chosen_travel_h!: number;
  /** Roznica czasu dojazdu: dodatnia = decyzja reczna wydluzyla dostawe. */
  @decimal() delta_travel_h!: number;
  @int() allocated_qty!: number;
  @text({ max: 12 }) resource_type_id!: string;
  @int() priority!: number;
  /** 'plan_optymalizatora' | 'korekta_reczna' | 'podzial_dostawy'. */
  @text({ min: 3, max: 30 }) mode!: string;
  /** Wymagane, gdy mode != 'plan_optymalizatora'. */
  @text({ max: 1200 }) override_reason!: string;
  @text({ max: 12 }) transport_unit_id!: string;
  @text({ max: 30 }) eta!: string;
  @text({ max: 64 }) audit_hash!: string;
  @text({ max: 120 }) author_id!: string;
  @text({ max: 160 }) author_name!: string;
  @text({ min: 3, max: 40 }) author_role!: string;
  @date() created_at!: Date;
}
