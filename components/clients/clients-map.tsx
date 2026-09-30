"use client"

import "leaflet/dist/leaflet.css"
import { useEffect, useRef } from "react"
import type * as Leaflet from "leaflet"

/**
 * The street map under the Clients page's Map view.
 *
 * The design (Clients Main.dc.html) draws pins on a plain grid as a
 * placeholder; a pin means little without streets under it, so this uses
 * Leaflet with OpenStreetMap's tiles. Pins are the design's teardrop in the
 * cleaner's colour; hover shows the name, click opens a card with "View
 * Profile".
 *
 * Leaflet touches `window` when it loads, so it is imported inside the effect,
 * and this whole component is loaded only when the Map view is opened.
 */

export interface ClientMapPin {
  key: string
  clientId: string
  lat: number
  lng: number
  color: string
  label: string
  area: string
  cleaner: string
  money: string
  schedule: string
}

/** Los Angeles, for when nothing is on the map yet. */
const LA: [number, number] = [34.05, -118.33]

const safeColor = (c: string) => (/^#[0-9a-f]{3,8}$/i.test(c) ? c : "#64748b")

/** Built from text nodes: client names and schedules are never read as HTML. */
function card(pin: ClientMapPin, onOpen: (id: string) => void): HTMLElement {
  const el = document.createElement("div")
  el.className = "cfcl-map-card"
  const line = (text: string, className: string) => {
    const div = document.createElement("div")
    div.className = className
    div.textContent = text
    el.appendChild(div)
    return div
  }
  line(pin.label, "cfcl-map-card-name")
  if (pin.area) line(pin.area, "cfcl-map-card-area")
  const cleaner = line(pin.cleaner, "cfcl-map-card-cleaner")
  const dot = document.createElement("span")
  dot.style.background = safeColor(pin.color)
  cleaner.prepend(dot)
  const money = line(pin.money, "cfcl-map-card-money")
  const schedule = document.createElement("span")
  schedule.textContent = pin.schedule
  money.appendChild(schedule)
  const button = document.createElement("button")
  button.type = "button"
  button.textContent = "View Profile"
  button.addEventListener("click", () => onOpen(pin.clientId))
  el.appendChild(button)
  return el
}

export default function ClientsMap({ pins, onOpen }: { pins: ClientMapPin[]; onOpen: (id: string) => void }) {
  const host = useRef<HTMLDivElement>(null)
  const map = useRef<Leaflet.Map | null>(null)
  const layer = useRef<Leaflet.LayerGroup | null>(null)
  const leaflet = useRef<typeof Leaflet | null>(null)
  const open = useRef(onOpen)
  open.current = onOpen
  const latestPins = useRef(pins)
  latestPins.current = pins

  const draw = () => {
    const L = leaflet.current
    if (!L || !map.current || !layer.current) return
    layer.current.clearLayers()
    const current = latestPins.current
    for (const pin of current) {
      const icon = L.divIcon({
        className: "cfcl-pin",
        html: `<span style="background:${safeColor(pin.color)}"></span>`,
        iconSize: [18, 18],
        iconAnchor: [9, 20],
      })
      const tip = document.createElement("span")
      tip.textContent = pin.label
      const marker = L.marker([pin.lat, pin.lng], { icon, title: pin.label, keyboard: true })
        .bindTooltip(tip, { direction: "top", offset: [0, -18] })
        .bindPopup(card(pin, id => open.current(id)), {
          closeButton: false,
          offset: [0, -16],
          minWidth: 210,
          // Clear of the "Greater Los Angeles" label and the zoom buttons.
          autoPanPaddingTopLeft: [60, 64],
          autoPanPaddingBottomRight: [20, 20],
        })
        .addTo(layer.current)
      // The card already names the client; the hover label would sit behind it.
      marker.on("popupopen", () => marker.closeTooltip())
    }
    if (current.length === 1) map.current.setView([current[0].lat, current[0].lng], 13)
    else if (current.length > 1) {
      map.current.fitBounds(L.latLngBounds(current.map(p => [p.lat, p.lng] as [number, number])), { padding: [40, 40], maxZoom: 14 })
    } else map.current.setView(LA, 10)
  }

  useEffect(() => {
    let cancelled = false
    let resize: ResizeObserver | null = null
    void import("leaflet").then(mod => {
      const L = (mod as unknown as { default?: typeof Leaflet }).default ?? (mod as unknown as typeof Leaflet)
      if (cancelled || !host.current || map.current) return
      leaflet.current = L
      // The wheel scrolls the page until the map is clicked, so scrolling
      // down the Clients page never zooms the map by accident.
      map.current = L.map(host.current, { center: LA, zoom: 10, scrollWheelZoom: false })
      const m = map.current
      m.on("click", () => m.scrollWheelZoom.enable())
      m.on("mouseout", () => m.scrollWheelZoom.disable())
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map.current)
      layer.current = L.layerGroup().addTo(map.current)
      draw()
      // Leaflet measures its box once; tell it when the page or pane resizes.
      resize = new ResizeObserver(() => map.current?.invalidateSize())
      resize.observe(host.current)
    })
    return () => {
      cancelled = true
      resize?.disconnect()
      map.current?.remove()
      map.current = null
      layer.current = null
    }
    // Created once; pins are drawn by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Redraw when the set of pins changes (a search or a tab narrows the list).
  const pinKey = pins.map(p => p.key).join("|")
  useEffect(() => {
    draw()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinKey])

  return (
    <>
      <style>{`
        .cfcl-leaflet { position: absolute; inset: 0; isolation: isolate; z-index: 0; }
        .cfcl-leaflet .leaflet-tile-pane { filter: saturate(0.55) brightness(1.03); }
        .cfcl-pin { background: none; border: none; }
        .cfcl-pin span { display: block; width: 14px; height: 14px; margin: 1px; border-radius: 50% 50% 50% 0; transform: rotate(-45deg); border: 2px solid #fff; box-shadow: 0 1px 3px rgba(0,0,0,.3); }
        .cfcl-map-card { font-family: inherit; }
        .cfcl-map-card-name { font-size: 13px; font-weight: 800; color: #1a1a1a; margin-bottom: 2px; }
        .cfcl-map-card-area { font-size: 11px; color: #8a857a; margin-bottom: 4px; }
        .cfcl-map-card-cleaner { display: flex; align-items: center; gap: 5px; font-size: 11.5px; color: #5c574e; margin-bottom: 4px; }
        .cfcl-map-card-cleaner span { width: 6px; height: 6px; border-radius: 50%; flex: none; }
        .cfcl-map-card-money { display: flex; gap: 8px; font-size: 11.5px; font-weight: 800; color: #1a1a1a; }
        .cfcl-map-card-money span { font-weight: 400; color: #8a857a; }
        .cfcl-map-card button { margin-top: 8px; width: 100%; padding: 6px 0; font-size: 11.5px; font-weight: 700; background: #0d9488; color: #fff; border: none; border-radius: 7px; cursor: pointer; font-family: inherit; }
        .cfcl-leaflet .leaflet-popup-content-wrapper { border-radius: 10px; box-shadow: 0 6px 18px rgba(40,30,10,0.14); }
        .cfcl-leaflet .leaflet-popup-content { margin: 10px 14px; }
      `}</style>
      <div ref={host} className="cfcl-leaflet" />
    </>
  )
}
