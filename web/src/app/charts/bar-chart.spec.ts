import { TestBed } from '@angular/core/testing';
import { BarChart } from './bar-chart';
import { ColumnChart } from './column-chart';

describe('gráficos', () => {
  it('BarChart escala al máximo y atenúa muestras pequeñas', async () => {
    const f = TestBed.createComponent(BarChart);
    f.componentRef.setInput('data', [
      { label: 'a', value: 200 },
      { label: 'b', value: 50, muted: true, hint: '2 obras' },
    ]);
    await f.whenStable();
    const el = f.nativeElement as HTMLElement;
    const fills = [...el.querySelectorAll<HTMLElement>('.bars__fill')].map((x) => x.style.width);
    expect(fills).toEqual(['100%', '25%']);
    expect(el.querySelector('.bars__row--muted')?.textContent).toContain('2 obras');
  });
  it('estado vacío', async () => {
    const f = TestBed.createComponent(ColumnChart);
    f.componentRef.setInput('data', []);
    await f.whenStable();
    expect((f.nativeElement as HTMLElement).textContent).toContain('Sin datos suficientes');
  });
});
