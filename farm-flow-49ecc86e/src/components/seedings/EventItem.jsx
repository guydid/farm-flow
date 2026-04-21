
import React from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { format, parseISO } from "date-fns";
import { he } from "date-fns/locale";
import { Tractor, Droplets, Leaf, Edit, Trash2, Copy } from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge"; // Added Badge component

// Minimal eventConfig to only hold icon and color properties
const eventConfig = {
    activity: {
        icon: Tractor,
        color: "bg-orange-100",
        iconColor: "text-orange-600",
    },
    harvest: {
        icon: Leaf,
        color: "bg-green-100",
        iconColor: "text-green-600",
    },
    spraying: {
        icon: Droplets,
        color: "bg-blue-100",
        iconColor: "text-blue-600",
    }
};

export default function EventItem({ event, onEdit, onDelete, onDuplicate }) {
    const config = eventConfig[event.type];
    if (!config) return null;

    const Icon = config.icon;

    const renderEventDetails = () => {
        if (event.type === 'activity') {
            return (
                <div className="space-y-1">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">{event.activity_type}</span>
                            <Link 
                                to={createPageUrl("Settings?tab=activity_types")}
                                className="text-blue-600 hover:text-blue-800"
                                title="נהל סוגי פעילויות"
                            >
                                <ExternalLink className="h-3 w-3" />
                            </Link>
                        </div>
                        {event.total_cost && (
                            <Badge variant="outline" className="bg-red-50 text-red-700">
                                ₪{parseFloat(event.total_cost).toLocaleString()}
                            </Badge>
                        )}
                    </div>
                    {event.area_covered && (
                        <p className="text-xs text-gray-600">שטח: {event.area_covered} דונם</p>
                    )}
                    {event.performed_by && (
                        <p className="text-xs text-gray-600">בוצע ע"י: {event.performed_by}</p>
                    )}
                </div>
            );
        }

        if (event.type === 'harvest') {
            return (
                <div className="space-y-1">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">
                                {event.variety || 'לא צוין זן'}
                            </span>
                            <Link 
                                to={createPageUrl("Settings?tab=varieties")}
                                className="text-blue-600 hover:text-blue-800"
                                title="נהל זנים"
                            >
                                <ExternalLink className="h-3 w-3" />
                            </Link>
                        </div>
                        {event.price_per_unit && event.quantity && (
                            <Badge variant="outline" className="bg-green-50 text-green-700">
                                ₪{(parseFloat(event.price_per_unit) * parseFloat(event.quantity)).toLocaleString()}
                            </Badge>
                        )}
                    </div>
                    <div className="flex gap-3 text-xs text-gray-600 flex-wrap"> {/* Added flex-wrap for better layout */}
                        {event.weight && <span>משקל: {event.weight} ק"ג</span>}
                        {event.quality && <span>איכות: {event.quality}</span>}
                        {event.packaging && (
                            <span className="flex items-center gap-1">
                                אריזה: {event.packaging}
                                <Link 
                                    to={createPageUrl("Settings?tab=packaging")}
                                    className="text-blue-600 hover:text-blue-800"
                                    title="נהל אריזות"
                                >
                                    <ExternalLink className="h-3 w-3" />
                                </Link>
                            </span>
                        )}
                    </div>
                </div>
            );
        }

        if (event.type === 'spraying') {
            return (
                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">
                            {event.treatment_type === 'mechanized' ? 'ממוכן' :
                             event.treatment_type === 'spray_gun' ? 'אקדח ריסוס' :
                             event.treatment_type === 'backpack' ? 'ריסוס גב' :
                             event.treatment_type === 'drench' ? 'הגמעה' : event.treatment_type}
                        </span>
                        {event.total_cost && (
                            <Badge variant="outline" className="bg-blue-50 text-blue-700">
                                ₪{parseFloat(event.total_cost).toLocaleString()}
                            </Badge>
                        )}
                    </div>
                    {event.applied_pesticides && event.applied_pesticides.length > 0 && (
                        <div className="space-y-1">
                            <div className="flex items-center gap-2 text-xs text-gray-600">
                                <span>חומרי הדברה:</span>
                                <Link 
                                    to={createPageUrl("Settings?tab=pesticides")}
                                    className="text-blue-600 hover:text-blue-800"
                                    title="נהל חומרי הדברה"
                                >
                                    <ExternalLink className="h-3 w-3" />
                                </Link>
                            </div>
                            <div className="pr-4">
                                {event.applied_pesticides.map((p, index) => (
                                    <div key={index} className="text-xs text-gray-700">
                                        • {p.pesticide_name} - {p.quantity} {p.unit}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                    {event.area_covered && (
                        <p className="text-xs text-gray-600">שטח: {event.area_covered} דונם</p>
                    )}
                </div>
            );
        }

        return null;
    };

    return (
        <Card className="hover:shadow-md transition-shadow duration-200">
            <CardContent className="p-4 flex items-start gap-4">
                <div className={`w-12 h-12 rounded-lg flex-shrink-0 flex items-center justify-center ${config.color}`}>
                    <Icon className={`w-6 h-6 ${config.iconColor}`} />
                </div>
                <div className="flex-grow">
                    <div className="flex justify-end mb-1"> {/* Date moved to be at the top right */}
                        <span className="text-sm text-gray-500">{event.date ? format(parseISO(event.date), 'dd/MM/yyyy', { locale: he }) : ''}</span>
                    </div>
                    {renderEventDetails()} {/* Render the new detailed event content */}
                    {event.notes && <p className="text-xs text-gray-500 mt-2 italic">הערות: {event.notes}</p>}
                </div>
                <div className="flex flex-col gap-1">
                    <Button variant="ghost" size="icon" onClick={() => onEdit(event)} title="ערוך">
                        <Edit className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => onDuplicate(event)} title="שכפל" className="text-blue-500 hover:text-blue-600">
                        <Copy className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => onDelete(event)} className="text-red-500 hover:text-red-600" title="מחק">
                        <Trash2 className="w-4 h-4" />
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}
