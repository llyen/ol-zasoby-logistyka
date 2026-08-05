import { entity, role, text, int, date, uuid } from '@microsoft/rayfin-core';

/**
 * Wniosek o zasob zlozony przez gmine albo powiat (Ekran „Zloz wniosek”).
 *
 * Wniosku nie usuwa sie - wycofanie to zmiana statusu na 'wycofany', zeby kolejka
 * WCZK i audyt zachowaly slad. Dlatego brak roli z akcja 'delete'.
 * Aktualizacja jest dozwolona wylacznie autorowi (uzupelnienie przed decyzja).
 */
@entity()
@role('authenticated', ['create', 'read'])
@role('authenticated', ['update'], {
  policy: (claims, item) => claims.sub.eq(item.author_id),
})
export class DemandRequest {
  @uuid() id!: string;
  /** Identyfikator nadawany w aplikacji, np. WN-2026-09-17-014. */
  @text({ min: 3, max: 40 }) request_id!: string;
  /** Dzien sceny, ktorego dotyczy wniosek (YYYY-MM-DD). */
  @text({ min: 10, max: 10 }) scene_day!: string;
  @text({ min: 4, max: 12 }) gmina_code!: string;
  @text({ max: 120 }) gmina_name!: string;
  @text({ max: 4 }) voivodeship_code!: string;
  @text({ min: 2, max: 12 }) resource_type_id!: string;
  @text({ max: 80 }) resource_name!: string;
  @int() quantity!: number;
  @text({ max: 20 }) unit!: string;
  /** 1 = zagrozenie zycia, 4 = planowe. */
  @int() priority!: number;
  @int() affected_people!: number;
  /** Termin, do ktorego zasob jest potrzebny (ISO). */
  @text({ max: 30 }) needed_by!: string;
  @text({ min: 20, max: 1200 }) justification!: string;
  /** Ilosc podpowiedziana przez kalkulator norm - do porownania z wpisana. */
  @int() suggested_quantity!: number;
  /** 'szkic' | 'zlozony' | 'wycofany'. */
  @text({ min: 3, max: 20 }) status!: string;
  @text({ max: 120 }) author_id!: string;
  @text({ max: 160 }) author_name!: string;
  @text({ min: 3, max: 40 }) author_role!: string;
  @date() created_at!: Date;
}
