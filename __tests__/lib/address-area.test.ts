import { describe, it, expect } from "vitest"
import { areaFromAddress, firstArea } from "@/lib/address-area"

// Every shape below is one that is in the live data.
describe("the city a free-text address is in", () => {
  it("reads a tidy address", () => {
    expect(areaFromAddress("2936 Beverly Glen Cir, Los Angeles, CA 90077")).toBe("Los Angeles")
    expect(areaFromAddress("9300 Jefferson Blvd, Culver City, CA 90232")).toBe("Culver City")
  })

  it("does not mistake the state and zip for the city", () => {
    // The old rule took the second-to-last comma piece, which here is "CA 90027".
    expect(areaFromAddress("1917 Hillhurst Ave. Los Angeles, CA 90027")).toBe("Los Angeles")
    expect(areaFromAddress("1122 Wilshire Boulevard Los Angeles, CA 90017")).toBe("Los Angeles")
  })

  it("does not mistake a unit for the city", () => {
    expect(areaFromAddress("3231 Ocean Park Blvd, Unit #222, Santa Monica CA 90405")).toBe("Santa Monica")
    expect(areaFromAddress("271 Shoppers Lane, Unit 201 Pasadena, CA 91101")).toBe("Pasadena")
    expect(areaFromAddress("3601 Oceanview Blvd, Ste K, Los Angeles, CA 91208")).toBe("Los Angeles")
    expect(areaFromAddress("9200 Sunset Blvd Suite 215, West Hollywood, CA 90069")).toBe("West Hollywood")
    expect(areaFromAddress("950 S Fairfax Ave #112, Los Angeles, CA 90036")).toBe("Los Angeles")
  })

  it("finds the city when no comma separates it from the street", () => {
    expect(areaFromAddress("2518 W Burbank Blvd Burbank, CA 91505")).toBe("Burbank")
    expect(areaFromAddress("13122 S Normandie Ave. Gardena, CA 90249")).toBe("Gardena")
    expect(areaFromAddress("11736 Vose St. North Hollywood, CA 91605")).toBe("North Hollywood")
    expect(areaFromAddress("719 S Los Angeles St. Los Angeles, CA 90014")).toBe("Los Angeles")
    expect(areaFromAddress("2711 W. Ave 34 Glassell Park, CA 90065")).toBe("Glassell Park")
  })

  it("copes with a state written loosely", () => {
    expect(areaFromAddress("29 S. Electric Ave. Alhambra CA 91801")).toBe("Alhambra")
    expect(areaFromAddress("3975 Landmark St. Culver City CA. 90232")).toBe("Culver City")
    expect(areaFromAddress("470 S. Beverly Drive Beverly Hills , CA 90212")).toBe("Beverly Hills")
    expect(areaFromAddress("1 Main St, Pasadena, California 91101, USA")).toBe("Pasadena")
  })

  it("says nothing rather than guess from an address with no city in it", () => {
    expect(areaFromAddress("San Jose 11")).toBe("")
    expect(areaFromAddress("Creek View Court")).toBe("")
    expect(areaFromAddress("")).toBe("")
    expect(areaFromAddress(null)).toBe("")
  })

  it("takes a plain last piece when there is no state", () => {
    expect(areaFromAddress("12 Oak St, Pasadena")).toBe("Pasadena")
  })
})

describe("a client's area", () => {
  it("comes from the first location that has one", () => {
    // 1440 23rd Street: its first location's address is "San Jose 11".
    expect(firstArea(["San Jose 11", "1440 23rd St, Santa Monica, CA 90404"])).toBe("Santa Monica")
  })

  it("is empty when no location has one", () => {
    expect(firstArea(["Creek View Court", null])).toBe("")
  })
})
