import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useRef } from 'react';
import VirtualProductList, {
    VirtualProductTableBody
} from '../../src/components/common/VirtualProductList';
import { resolveVirtualColumns } from '../../src/utils/virtualColumns';
import {
    createCatalogIndex,
    searchCatalogIndex
} from '../../src/utils/catalogSearchEngine';
import { useFuzzySearch } from '../../src/hooks/useFuzzySearch';

function buildMockProducts(count = 2000) {
    const categories = ['Bebidas', 'Charcutería', 'Farmacia', 'Lácteos', 'Snacks'];
    const items = new Array(count);
    for (let i = 0; i < count; i++) {
        const cat = categories[i % categories.length];
        items[i] = {
            id: `prod-${i + 1}`,
            name: `Producto ${cat} #${i + 1}`,
            barcode: `759000${String(i + 1).padStart(6, '0')}`,
            sku: `SKU-${i + 1}`,
            category: cat,
            price: Number(((i % 50) + 1.25).toFixed(2)),
            stockQuantity: i % 10 === 0 ? 0 : 25,
            Presentations: i === 1234 ? [{ barcode: 'PRES-BULK-1234', name: 'Caja x12' }] : [],
            Variantes: i === 2345 ? [{ sku_variante: 'VAR-ROJO-XL-2345', codigo_barras: '759999992345' }] : []
        };
    }
    return items;
}

function TableHarness({ items }) {
    const scrollRef = useRef(null);
    return (
        <div ref={scrollRef} style={{ height: '500px', overflowY: 'auto' }}>
            <table>
                <thead>
                    <tr>
                        <th>Producto</th>
                        <th>Precio</th>
                    </tr>
                </thead>
                <VirtualProductTableBody
                    items={items}
                    colSpan={2}
                    scrollElementRef={scrollRef}
                    estimateSize={50}
                    overscan={4}
                    initialHeight={500}
                    renderRow={(item, idx, measureRef) => (
                        <tr key={item.id} ref={measureRef} data-index={idx} data-testid="vtable-row">
                            <td>{item.name}</td>
                            <td>{item.price}</td>
                        </tr>
                    )}
                />
            </table>
        </div>
    );
}

function SearchHookHarness({ data, term, options }) {
    const results = useFuzzySearch(data, term, options);
    return (
        <div>
            <span data-testid="result-count">{results.length}</span>
            <span data-testid="first-id">{results[0]?.id || ''}</span>
        </div>
    );
}

describe('Fase 1 — Virtualización @tanstack/react-virtual y Motor de Búsqueda 5.000+ SKUs', () => {
    it('VirtualProductList renderiza solo una fracción acotada del DOM con 2.000 productos en lista', () => {
        const items = buildMockProducts(2000);
        render(
            <VirtualProductList
                items={items}
                columns={1}
                estimateSize={80}
                gap={8}
                overscan={4}
                initialHeight={640}
                testId="vlist-single"
                renderItem={(item) => (
                    <div data-testid="vlist-card">{item.name}</div>
                )}
            />
        );

        const rendered = screen.getAllByTestId('vlist-card');
        expect(rendered.length).toBeGreaterThan(0);
        expect(rendered.length).toBeLessThan(60);
        expect(screen.getByTestId('vlist-single').getAttribute('data-virtual-total-items')).toBe('2000');
    });

    it('VirtualProductList virtualiza filas completas en modo grilla responsiva (3 columnas) con 2.000 productos', () => {
        const items = buildMockProducts(2000);
        render(
            <VirtualProductList
                items={items}
                columns={3}
                estimateSize={200}
                gap={12}
                overscan={4}
                initialHeight={600}
                testId="vlist-grid"
                renderItem={(item) => (
                    <div data-testid="vgrid-card">{item.name}</div>
                )}
            />
        );

        const rendered = screen.getAllByTestId('vgrid-card');
        expect(rendered.length).toBeGreaterThan(0);
        expect(rendered.length).toBeLessThan(90);
        expect(screen.getByTestId('vlist-grid').getAttribute('data-virtual-columns')).toBe('3');
    });

    it('VirtualProductTableBody virtualiza filas <tr> con 2.000 productos sin renderizar toda la tabla', () => {
        const items = buildMockProducts(2000);
        render(<TableHarness items={items} />);

        const rows = screen.getAllByTestId('vtable-row');
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.length).toBeLessThan(60);
    });

    it('resolveVirtualColumns calcula columnas responsivas para breakpoints y minItemWidth', () => {
        expect(resolveVirtualColumns({ default: 1, md: 2, xl: 3 }, 375)).toBe(1);
        expect(resolveVirtualColumns({ default: 1, md: 2, xl: 3 }, 800)).toBe(2);
        expect(resolveVirtualColumns({ default: 1, md: 2, xl: 3 }, 1440)).toBe(3);
        expect(resolveVirtualColumns({ minItemWidth: 215, gap: 12, padX: 28 }, 1000)).toBe(4);
    });

    it('catalogSearchEngine indexa 5.000 SKUs con O(1) por categoría, barcode, presentación y variante', () => {
        const catalog = buildMockProducts(5000);
        const index = createCatalogIndex(catalog);

        // Pre-indexado O(1) por categoría (ignora tildes/mayúsculas)
        const charcuteria = searchCatalogIndex(index, '', { category: 'Charcutería', maxResults: 2000 });
        expect(charcuteria.length).toBe(1000);
        expect(charcuteria.every(p => p.category === 'Charcutería')).toBe(true);

        // O(1) código de barras principal
        const exactBarcode = searchCatalogIndex(index, '759000004999');
        expect(exactBarcode.length).toBe(1);
        expect(exactBarcode[0].id).toBe('prod-4999');

        // O(1) código de barras de presentación
        const presHit = searchCatalogIndex(index, 'PRES-BULK-1234');
        expect(presHit.length).toBe(1);
        expect(presHit[0].id).toBe('prod-1235');

        // O(1) SKU de variante
        const varHit = searchCatalogIndex(index, 'VAR-ROJO-XL-2345');
        expect(varHit.length).toBe(1);
        expect(varHit[0].id).toBe('prod-2346');

        // Categoría + texto combinados
        const combined = searchCatalogIndex(index, '#4996', { category: 'Bebidas', maxResults: 50 });
        expect(combined.length).toBe(1);
        expect(combined[0].id).toBe('prod-4996');

        // Aislamiento de categoría: no retorna producto de otra categoría aunque el barcode exista
        const wrongCat = searchCatalogIndex(index, '759000004999', { category: 'Bebidas' });
        expect(wrongCat.length).toBe(0);
    });

    it('useFuzzySearch mantiene compatibilidad con 2 argumentos y soporta filtro de categoría en opciones', () => {
        const catalog = buildMockProducts(200);

        const { rerender } = render(
            <SearchHookHarness data={catalog} term="759000000050" />
        );
        expect(screen.getByTestId('result-count').textContent).toBe('1');
        expect(screen.getByTestId('first-id').textContent).toBe('prod-50');

        rerender(
            <SearchHookHarness
                data={catalog}
                term=""
                options={{ category: 'Farmacia', maxResults: 100, enableSemantic: false }}
            />
        );
        expect(screen.getByTestId('result-count').textContent).toBe('40');
    });
});
