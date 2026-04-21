
import React from 'react';
import { format } from 'date-fns';

const SummarySticker = React.forwardRef(({ certificate, items, customer, companySettings }, ref) => {
    if (!certificate || !items || !customer) return null;

    const totalWeight = items.reduce((sum, item) => sum + (item.net_weight || 0), 0);
    const totalPackages = items.reduce((sum, item) => sum + (item.package_count || 0), 0);
    const totalAmount = items.reduce((sum, item) => sum + (item.item_total || 0), 0);

    return (
        <div 
            ref={ref} 
            className="bg-white border-2 border-black"
            style={{ 
                width: '10cm', 
                height: '15cm', 
                direction: 'rtl', 
                fontFamily: 'Arial, sans-serif',
                fontSize: '11px',
                padding: '8px',
                boxSizing: 'border-box',
                display: 'flex',
                flexDirection: 'column'
            }}
        >
            {/* Company Header */}
            {companySettings && (
                <div style={{ 
                    textAlign: 'center', 
                    borderBottom: '2px solid black', 
                    paddingBottom: '6px',
                    marginBottom: '8px'
                }}>
                    <div style={{ fontSize: '14px', fontWeight: 'bold' }}>
                        {companySettings.company_name}
                    </div>
                    {companySettings.phone && (
                        <div style={{ fontSize: '10px' }}>טל: {companySettings.phone}</div>
                    )}
                </div>
            )}

            {/* Title */}
            <div style={{ 
                textAlign: 'center', 
                fontSize: '16px', 
                fontWeight: 'bold',
                marginBottom: '8px',
                backgroundColor: '#f0f0f0',
                padding: '4px',
                borderRadius: '4px'
            }}>
                תעודת שקילה - ריכוז
            </div>

            {/* Certificate Info */}
            <div style={{ 
                display: 'grid', 
                gridTemplateColumns: '1fr 1fr', 
                gap: '4px',
                fontSize: '10px',
                marginBottom: '8px',
                paddingBottom: '6px',
                borderBottom: '1px solid #ccc'
            }}>
                <div><strong>לקוח:</strong> {customer.name}</div>
                <div><strong>תאריך:</strong> {format(new Date(certificate.date), 'dd/MM/yyyy')}</div>
                <div><strong>נהג:</strong> {certificate.driver_name || 'לא צוין'}</div>
                <div><strong>שעה:</strong> {certificate.time || 'לא צוין'}</div>
                {certificate.vehicle_number && (
                    <div style={{ gridColumn: 'span 2' }}>
                        <strong>רכב:</strong> {certificate.vehicle_number}
                    </div>
                )}
            </div>

            {/* Items Summary */}
            <div style={{ 
                flexGrow: 1,
                marginBottom: '8px'
            }}>
                <div style={{ 
                    fontSize: '12px', 
                    fontWeight: 'bold', 
                    marginBottom: '6px',
                    textAlign: 'center'
                }}>
                    פירוט משטחים ({items.length})
                </div>
                
                <div style={{ 
                    maxHeight: '120px',
                    overflowY: 'auto',
                    border: '1px solid #ccc',
                    padding: '4px',
                    fontSize: '9px'
                }}>
                    {items.map((item, index) => (
                        <div key={index} style={{ 
                            display: 'grid',
                            gridTemplateColumns: '2fr 1fr 1fr',
                            gap: '4px',
                            paddingBottom: '2px',
                            borderBottom: index < items.length - 1 ? '1px dotted #ccc' : 'none',
                            marginBottom: '2px'
                        }}>
                            <div>{item.product_name} {item.quality}</div>
                            <div>{item.package_count} יח׳</div>
                            <div>
                                {item.pricing_method === 'per_kg' && item.net_weight 
                                    ? `${item.net_weight.toFixed(1)} ק"ג`
                                    : 'יחידות'
                                }
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Totals */}
            <div style={{ 
                backgroundColor: '#f8f8f8',
                padding: '8px',
                border: '2px solid black',
                textAlign: 'center'
            }}>
                <div style={{ 
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '8px',
                    marginBottom: '6px'
                }}>
                    <div>
                        <div style={{ fontSize: '10px', color: '#666' }}>סה"כ משקל</div>
                        <div style={{ fontSize: '14px', fontWeight: 'bold' }}>
                            {totalWeight.toFixed(1)} ק"ג
                        </div>
                    </div>
                    <div>
                        <div style={{ fontSize: '10px', color: '#666' }}>סה"כ אריזות</div>
                        <div style={{ fontSize: '14px', fontWeight: 'bold' }}>
                            {totalPackages}
                        </div>
                    </div>
                </div>
                
                {totalAmount > 0 && (
                    <div style={{ 
                        borderTop: '1px solid #ccc',
                        paddingTop: '6px',
                        fontSize: '16px',
                        fontWeight: 'bold'
                    }}>
                        סה"כ: ₪{totalAmount.toLocaleString(undefined, { 
                            minimumFractionDigits: 2, 
                            maximumFractionDigits: 2 
                        })}
                    </div>
                )}
            </div>

            {/* Footer */}
            <div style={{ 
                textAlign: 'center',
                fontSize: '9px',
                color: '#666',
                marginTop: '4px'
            }}>
                תעודה #{certificate.id.slice(-6)}
            </div>
        </div>
    );
});

SummarySticker.displayName = 'SummarySticker';

export default SummarySticker;
