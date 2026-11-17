import { describe, expect, it } from 'vitest';
import { planStepValidation, pendingCoins, daysSince, MAX_DAILY_STEPS } from './stepValidation';

const TODAY = '2026-11-17';

const base = {
  today: TODAY,
  profile: { lastValidatedDate: '2026-11-16', streak: 4, streakFreezes: 1 },
};

describe('planStepValidation — validations multiples dans la journée', () => {
  it('crédite la première validation du jour et avance la série', () => {
    const plan = planStepValidation({
      ...base,
      stepsToday: 6200,
      previous: null,
    });
    expect(plan.firstOfDay).toBe(true);
    expect(plan.addedSteps).toBe(6200);
    expect(plan.steps).toBe(6200);
    expect(plan.coins).toBe(5);
    expect(plan.addedCoins).toBe(5);
    expect(plan.streak).toBe(5);
    expect(plan.freezeUsed).toBe(false);
  });

  it('crédite seulement le delta à la seconde validation, sans toucher la série', () => {
    const first = planStepValidation({ ...base, stepsToday: 6200, previous: null });
    const second = planStepValidation({
      today: TODAY,
      profile: { lastValidatedDate: TODAY, streak: first.streak, streakFreezes: first.streakFreezes },
      previous: { steps: first.steps, coins: first.coins, calories: first.calories },
      stepsToday: 12400,
    });
    expect(second.firstOfDay).toBe(false);
    expect(second.addedSteps).toBe(6200);
    // Cumul de la journée : 12 400 pas → palier à 10 EC (et non 5 + 10).
    expect(second.coins).toBe(10);
    expect(second.addedCoins).toBe(5);
    expect(second.streak).toBe(5);
  });

  it('accepte trois validations dans la même journée', () => {
    let previous: { steps: number; coins: number; calories: number } | null = null;
    let streak = 4;
    let lastValidatedDate = '2026-11-16';
    const coins: number[] = [];
    [1500, 5600, 15200].forEach((stepsToday) => {
      const plan = planStepValidation({
        today: TODAY,
        profile: { lastValidatedDate, streak, streakFreezes: 1 },
        previous,
        stepsToday,
      });
      coins.push(plan.addedCoins);
      previous = { steps: plan.steps, coins: plan.coins, calories: plan.calories };
      streak = plan.streak;
      lastValidatedDate = TODAY;
    });
    // Paliers cumulés 1 → 5 → 15 EC : le total crédité suit le barème du jour.
    expect(coins).toEqual([1, 4, 10]);
    expect(coins.reduce((a, b) => a + b, 0)).toBe(15);
    expect(streak).toBe(5);
  });

  it('refuse une validation sans nouveau pas', () => {
    expect(() =>
      planStepValidation({
        today: TODAY,
        profile: { lastValidatedDate: TODAY, streak: 5, streakFreezes: 1 },
        previous: { steps: 8000, coins: 7, calories: 320 },
        stepsToday: 8000,
      })
    ).toThrow(/Aucun nouveau pas/);
  });

  it('refuse un compteur de pas qui recule (capteur réinitialisé)', () => {
    expect(() =>
      planStepValidation({
        today: TODAY,
        profile: { lastValidatedDate: TODAY, streak: 5, streakFreezes: 1 },
        previous: { steps: 9000, coins: 7, calories: 360 },
        stepsToday: 1200,
      })
    ).toThrow(/Aucun nouveau pas/);
  });

  it('plafonne le cumul quotidien au lieu de tout refuser', () => {
    const plan = planStepValidation({ ...base, stepsToday: MAX_DAILY_STEPS + 5000, previous: null });
    expect(plan.steps).toBe(MAX_DAILY_STEPS);
    expect(plan.addedSteps).toBe(MAX_DAILY_STEPS);
    expect(plan.coins).toBe(50);
  });

  it('ne fait jamais reculer les calories quand le profil santé change', () => {
    const plan = planStepValidation({
      today: TODAY,
      profile: { lastValidatedDate: TODAY, streak: 5, streakFreezes: 1 },
      previous: { steps: 1000, coins: 1, calories: 900 },
      stepsToday: 1100,
      health: { weightKg: 60, heightCm: 170 },
    });
    expect(plan.addedCalories).toBe(0);
    expect(plan.calories).toBe(900);
  });

  it('utilise un gel quand la veille a été manquée, une seule fois par jour', () => {
    const plan = planStepValidation({
      today: TODAY,
      profile: { lastValidatedDate: '2026-11-15', streak: 9, streakFreezes: 2 },
      previous: null,
      stepsToday: 4000,
    });
    expect(plan.freezeUsed).toBe(true);
    expect(plan.streak).toBe(10);
    expect(plan.streakFreezes).toBe(1);

    const later = planStepValidation({
      today: TODAY,
      profile: { lastValidatedDate: TODAY, streak: plan.streak, streakFreezes: plan.streakFreezes },
      previous: { steps: plan.steps, coins: plan.coins, calories: plan.calories },
      stepsToday: 9000,
    });
    expect(later.freezeUsed).toBe(false);
    expect(later.streakFreezes).toBe(1);
    expect(later.streak).toBe(10);
  });

  it('repart à une série de 1 après une journée manquée sans gel', () => {
    const plan = planStepValidation({
      today: TODAY,
      profile: { lastValidatedDate: '2026-11-13', streak: 12, streakFreezes: 0 },
      previous: null,
      stepsToday: 3000,
    });
    expect(plan.streak).toBe(1);
    expect(plan.freezeUsed).toBe(false);
  });

  it('tolère un profil sans historique', () => {
    const plan = planStepValidation({
      today: TODAY,
      profile: { lastValidatedDate: null, streak: 0 },
      previous: null,
      stepsToday: 2500,
    });
    expect(plan.streak).toBe(1);
    expect(plan.streakFreezes).toBe(1);
  });
});

describe('pendingCoins', () => {
  it('affiche la récompense encore disponible', () => {
    expect(pendingCoins(12400, 0)).toBe(10);
    expect(pendingCoins(12400, 6200)).toBe(5);
    expect(pendingCoins(12400, 12400)).toBe(0);
    expect(pendingCoins(800, 1200)).toBe(0);
  });

  it('ignore les valeurs invalides', () => {
    expect(pendingCoins(Number.NaN, 0)).toBe(0);
    expect(pendingCoins(5000, Number.NaN)).toBe(5);
  });
});

describe('daysSince', () => {
  it('compte les jours entre deux dates', () => {
    expect(daysSince('2026-11-16', TODAY)).toBe(1);
    expect(daysSince('2026-11-15', TODAY)).toBe(2);
    expect(daysSince(DATE_30_DAYS_BEFORE, TODAY)).toBe(30);
    expect(daysSince(null, TODAY)).toBeNull();
  });
});

const DATE_30_DAYS_BEFORE = '2026-10-18';
