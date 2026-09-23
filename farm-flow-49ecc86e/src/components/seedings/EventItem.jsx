
import React from 'react';
import { Button } from "@/components/ui/button";
import { format, parseISO } from "date-fns";
import { Tractor, Droplets, Leaf, Edit, Trash2, Copy, MoreVertical } from "lucide-react";
import {
    DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
    DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

const eventConfig = {
    activity: { icon: Tractor,  color: "bg-orange-100", iconColor: "text-orange-600" },
    harvest:  { icon: Leaf,     color: "bg-green-100",  iconColor: "text-green-600" },
    spraying: { icon: Droplets, color: "bg-blue-100",   iconColor: "text-blue-600" },
};

const TREATMENT_HE = { mechanized: 'ממוכן', spray_gun: 'אקדח ריסוס', backpack: 'ריסוס גב', drench: 'הגמעה' };

// כרטיס אירוע קומפקטי: שורה אחת עיקרית + שורת פרטים. לחיצה על הכרטיס = עריכה,
// תפריט ⋮ לשכפול/מחיקה.
export default function EventItem({ event, onEdit, onDelete, onDuplicate }) {
    const config = eventConfig[event.type];
    if (!config) return null;
    const Icon = config.icon;

    const dateStr = event.date ? format(parseISO(event.date), 'dd/MM/yy') : '';

    let title = '';
    let details = [];
    let amount = null;
    let amountColor = 'text-gray-700';

    if (event.type === 'activity') {
        title = event.activity_type || 'פעילות';
        if (event.area_covered) details.push(`${event.area_covered} דונם`);
        if (event.performed_by) details.push(event.performed_by);
        if (event.total_cost) { amount = `₪${parseFloat(event.total_cost).toLocaleString()}`; amountColor = 'text-red-600'; }
    } else if (event.type === 'harvest') {
        title = event.variety || 'קטיף';
        if (event.weight) details.push(`${parseFloat(event.weight).toLocaleString()} ק"ג`);
        if (event.quality) details.push(`איכות ${event.quality}`);
        if (event.packaging) details.push(event.packaging);
        if (event.price_per_unit && event.quantity) {
            amount = `₪${(parseFloat(event.price_per_unit) * parseFloat(event.quantity)).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
            amountColor = 'text-green-600';
        }
    } else if (event.type === 'spraying') {
        const method = event.control_method === 'biological' ? 'הדברה ביולוגית' : 'הדברה';
        title = `${method} · ${TREATMENT_HE[event.treatment_type] || event.treatment_type || ''}`;
        const pesticides = Array.isArray(event.applied_pesticides) ? event.applied_pesticides : [];
        if (pesticides.length > 0) {
            const names = pesticides.map(p => p.pesticide_name).filter(Boolean).join(', ');
            details.push(pesticides.length > 1 ? `${pesticides.length} חומרים: ${names}` : names);
        }
        if (event.area_covered) details.push(`${event.area_covered} דונם`);
        if (event.total_cost) { amount = `₪${parseFloat(event.total_cost).toLocaleString()}`; amountColor = 'text-red-600'; }
    }

    return (
        <div
            onClick={() => onEdit(event)}
            className="flex items-center gap-3 px-3 py-2.5 bg-white border border-gray-200 rounded-xl cursor-pointer transition-colors hover:shadow-sm active:bg-gray-50"
        >
            <div className={`w-9 h-9 rounded-lg flex-shrink-0 flex items-center justify-center ${config.color}`}>
                <Icon className={`w-5 h-5 ${config.iconColor}`} />
            </div>
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-gray-900 truncate">{title}</span>
                    <span className="text-[11px] text-gray-400 shrink-0">{dateStr}</span>
                </div>
                {(details.length > 0 || event.notes) && (
                    <div className="text-xs text-gray-500 truncate mt-0.5">
                        {details.join(' · ')}
                        {event.notes && <span className="italic"> {details.length > 0 ? '· ' : ''}{event.notes}</span>}
                    </div>
                )}
            </div>
            {amount && (
                <span className={`text-sm font-bold tabular-nums shrink-0 ${amountColor}`}>{amount}</span>
            )}
            <div onClick={(e) => e.stopPropagation()} className="shrink-0">
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-400">
                            <MoreVertical className="w-4 h-4" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => onEdit(event)}>
                            <Edit className="w-4 h-4 ml-2" /> ערוך
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onDuplicate(event)}>
                            <Copy className="w-4 h-4 ml-2" /> שכפל
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => onDelete(event)} className="text-red-600">
                            <Trash2 className="w-4 h-4 ml-2" /> מחק
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </div>
    );
}
