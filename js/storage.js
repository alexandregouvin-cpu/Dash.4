// Persistência local no aparelho (localStorage). Os dados não saem do celular.

const KEY = 'gastos:v1';

export const DEFAULT_SETTINGS = {
  monthlyBudget: 0, // centavos; 0 = sem orçamento
  dailyLimit: 0, // centavos; 0 = sem limite diário
  reminderEnabled: false,
  reminderTime: '21:00',
  budgetAlerts: true,
  autoPlace: false,
  lastReminderDate: '',
};

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const data = JSON.parse(raw);
      return {
        expenses: Array.isArray(data.expenses) ? data.expenses : [],
        settings: { ...DEFAULT_SETTINGS, ...(data.settings ?? {}) },
      };
    }
  } catch (err) {
    console.warn('Não foi possível ler os dados salvos', err);
  }
  return { expenses: [], settings: { ...DEFAULT_SETTINGS } };
}

export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ expenses: state.expenses, settings: state.settings }));
    return true;
  } catch (err) {
    console.warn('Não foi possível salvar', err);
    return false;
  }
}
