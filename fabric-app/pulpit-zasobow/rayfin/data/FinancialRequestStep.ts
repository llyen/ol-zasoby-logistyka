import { entity, role, text, int, date, uuid } from '@microsoft/rayfin-core';

/**
 * Wniosek o uruchomienie dodatkowych srodkow finansowych (SPO-2).
 *
 * Sciezka akceptacji jest wieloetapowa (wojewoda > minister wiodacy > RZZK > MF),
 * dlatego kazdy krok to osobny wiersz z tym samym financial_request_id i rosnacym
 * numerem kroku. Brak akcji 'delete' - wniosek moze byc tylko odrzucony.
 */
@entity()
@role('authenticated', ['create', 'read'])
export class FinancialRequestStep {
  @uuid() id!: string;
  @text({ min: 3, max: 40 }) financial_request_id!: string;
  @int() step_no!: number;
  @text({ min: 10, max: 10 }) scene_day!: string;
  @text({ max: 4 }) voivodeship_code!: string;
  /** Kwota w zlotych - int, bo demo nie operuje groszami. */
  @int() amount_pln!: number;
  @text({ min: 3, max: 80 }) purpose!: string;
  /** Wnioski ze sceny powiazane z ta kwota, rozdzielone przecinkiem. */
  @text({ max: 600 }) linked_demands!: string;
  @text({ min: 20, max: 1500 }) justification!: string;
  /** Pelna sciezka akceptacji, np. 'wojewoda>minister_wiodacy>RZZK>MF'. */
  @text({ max: 200 }) approval_path!: string;
  /** Etap, ktory wykonuje ten wiersz. */
  @text({ min: 3, max: 40 }) stage!: string;
  /** 'zlozony' | 'zaakceptowany' | 'odrzucony' | 'przekazany_dalej'. */
  @text({ min: 3, max: 30 }) status!: string;
  @text({ max: 1200 }) comment!: string;
  @text({ max: 64 }) audit_hash!: string;
  @text({ max: 120 }) author_id!: string;
  @text({ max: 160 }) author_name!: string;
  @text({ min: 3, max: 40 }) author_role!: string;
  @date() created_at!: Date;
}
