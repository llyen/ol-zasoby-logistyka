# Miary DAX — model semantyczny

Poniższe miary są projektowane dla modelu `OL_LOG_SemanticModel`. Nazwy tabel odpowiadają docelowym tabelom Lakehouse/Power BI. Każda miara ma opis biznesowy i format.

## 1. Demand Qty
**Opis:** suma zgłoszonych ilości zasobów. **Format:** liczba całkowita.
```dax
Demand Qty = SUM(fact_demand[quantity])
```

## 2. Allocated Qty
**Opis:** suma przydzielonych ilości. **Format:** liczba całkowita.
```dax
Allocated Qty = SUM(fact_allocation[allocated_qty])
```

## 3. Satisfied Demand %
**Opis:** procent ilości zapotrzebowań pokrytych przydziałami. **Format:** 0.0%.
```dax
Satisfied Demand % = DIVIDE([Allocated Qty], [Demand Qty])
```

## 4. Demand Count
**Opis:** liczba wniosków zapotrzebowania. **Format:** liczba całkowita.
```dax
Demand Count = COUNTROWS(fact_demand)
```

## 5. Priority 1 Demand Count
**Opis:** liczba zapotrzebowań priorytetu 1. **Format:** liczba całkowita.
```dax
Priority 1 Demand Count = CALCULATE([Demand Count], fact_demand[priority] = 1)
```

## 6. Priority 1 SLA %
**Opis:** udział priorytetu 1 z ETA do 6 godzin. **Format:** 0.0%.
```dax
Priority 1 SLA % =
DIVIDE(
    CALCULATE(
        COUNTROWS(fact_allocation),
        fact_demand[priority] = 1,
        fact_allocation[eta] <= fact_demand[timestamp] + TIME(6,0,0)
    ),
    CALCULATE(COUNTROWS(fact_demand), fact_demand[priority] = 1)
)
```

## 7. Avg Fulfillment Time h
**Opis:** średni czas od zgłoszenia do ETA. **Format:** 0.00 h.
```dax
Avg Fulfillment Time h =
AVERAGEX(
    fact_allocation,
    DATEDIFF(RELATED(fact_demand[timestamp]), fact_allocation[eta], MINUTE) / 60.0
)
```

## 8. Delayed Transport Count
**Opis:** liczba transportów z opóźnieniem powyżej 30 minut. **Format:** liczba całkowita.
```dax
Delayed Transport Count =
CALCULATE(
    DISTINCTCOUNT(fact_transport_tracking[transport_id]),
    fact_transport_tracking[delay_min] > 30
)
```

## 9. Max Delay min
**Opis:** największe opóźnienie. **Format:** 0 min.
```dax
Max Delay min = MAX(fact_transport_tracking[delay_min])
```

## 10. Shelter Occupancy %
**Opis:** obłożenie punktów przyjęcia. **Format:** 0.0%.
```dax
Shelter Occupancy % =
DIVIDE(
    SUM(fact_shelter_occupancy[occupied]),
    SUM(fact_shelter_occupancy[capacity])
)
```

## 11. Shelters Over 90 %
**Opis:** liczba punktów powyżej 90% pojemności. **Format:** liczba całkowita.
```dax
Shelters Over 90 % =
COUNTROWS(
    FILTER(
        VALUES(fact_shelter_occupancy[shelter_id]),
        CALCULATE([Shelter Occupancy %]) > 0.9
    )
)
```

## 12. Medical Care Required
**Opis:** osoby wymagające opieki medycznej. **Format:** liczba całkowita.
```dax
Medical Care Required = SUM(fact_shelter_occupancy[medical_care_required])
```

## 13. Available Stock
**Opis:** dostępny stan magazynowy. **Format:** liczba całkowita.
```dax
Available Stock = SUM(fact_stock[available_qty])
```

## 14. Reserved Stock
**Opis:** stan zarezerwowany. **Format:** liczba całkowita.
```dax
Reserved Stock = SUM(fact_stock[reserved_qty])
```

## 15. In Transit Stock
**Opis:** zasoby w drodze. **Format:** liczba całkowita.
```dax
In Transit Stock = SUM(fact_stock[in_transit_qty])
```

## 16. Days of Stock
**Opis:** liczba dni zapasu według prognozy. **Format:** 0.0 dnia.
```dax
Days of Stock =
DIVIDE(
    SUM(fact_stock[available_qty]),
    SUM(fact_consumption[daily_consumption])
)
```

## 17. Critical Stock Gaps
**Opis:** liczba kombinacji zasób/województwo z zapasem <2 dni. **Format:** liczba całkowita.
```dax
Critical Stock Gaps =
COUNTROWS(
    FILTER(depletion_forecast, depletion_forecast[days_of_stock] < 2)
)
```

## 18. Operation Cost PLN
**Opis:** roboczy koszt operacji logistycznej. **Format:** PLN.
```dax
Operation Cost PLN =
SUMX(
    fact_allocation,
    fact_allocation[allocated_qty] * RELATED(dim_resource_type[weight_kg]) * 0.45
)
```

## 19. SPO-2 Requested PLN
**Opis:** suma wnioskowanych środków. **Format:** PLN.
```dax
SPO-2 Requested PLN = SUM(fact_financial_request[amount_pln])
```

## 20. SPO-2 Over Limit Count
**Opis:** liczba wniosków powyżej 5 mln PLN. **Format:** liczba całkowita.
```dax
SPO-2 Over Limit Count =
CALCULATE(
    COUNTROWS(fact_financial_request),
    fact_financial_request[amount_pln] > 5000000
)
```

## 21. Road Impassable Count
**Opis:** liczba odcinków nieprzejezdnych. **Format:** liczba całkowita.
```dax
Road Impassable Count =
CALCULATE(
    COUNTROWS(fact_road_status),
    fact_road_status[status] = "nieprzejezdna"
)
```

## 22. Optimizer Time Saved h
**Opis:** różnica średniego czasu FIFO i optymalizacji z tabeli podsumowania. **Format:** 0.00 h.
```dax
Optimizer Time Saved h =
AVERAGE(allocation_summary[fifo_avg_delivery_time_h])
    - AVERAGE(allocation_summary[optimized_avg_delivery_time_h])
```

## Uwagi

W produkcyjnym modelu należy dodać tabelę daty, jawne relacje po kodach TERYT i osobne słowniki statusów. Dla tabel z Eventhouse część miar może być realizowana przez KQL i importowana jako agregaty.
