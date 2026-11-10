import { createContext, useContext, ReactNode } from 'react';
import { useSettings } from '@/hooks/useSettings';

interface CurrencyContextType {
  currencyCode: string;
  currencySymbol: string;
  formatCurrency: (amount: number) => string;
}

const CurrencyContext = createContext<CurrencyContextType>({
  currencyCode: 'USD',
  currencySymbol: '$',
  formatCurrency: (amount) => `$${amount.toFixed(2)}`,
});

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const { settings } = useSettings();
  
  const currencyCode = settings?.currency_code || 'USD';
  const currencySymbol = settings?.currency_symbol || '$';
  
  const formatCurrency = (amount: number): string => {
    return `${currencySymbol}${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  return (
    <CurrencyContext.Provider value={{ currencyCode, currencySymbol, formatCurrency }}>
      {children}
    </CurrencyContext.Provider>
  );
}

export function useCurrency() {
  const context = useContext(CurrencyContext);
  if (!context) {
    throw new Error('useCurrency must be used within a CurrencyProvider');
  }
  return context;
}
