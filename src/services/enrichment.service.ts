import axios from 'axios';

export interface EnrichedData {
  gender: string;
  gender_probability: number;
  sample_size: number;
  age: number;
  age_group: string;
  country_id: string;
  country_probability: number;
}

export class EnrichmentService {
  private static readonly GENDERIZE_URL = 'https://api.genderize.io';
  private static readonly AGIFY_URL = 'https://api.agify.io';
  private static readonly NATIONALIZE_URL = 'https://api.nationalize.io';

  static async enrichName(name: string): Promise<EnrichedData> {
    let genderRes, ageRes, nationRes;

    try {
      [genderRes, ageRes, nationRes] = await Promise.all([
        axios.get(`${this.GENDERIZE_URL}?name=${encodeURIComponent(name)}`),
        axios.get(`${this.AGIFY_URL}?name=${encodeURIComponent(name)}`),
        axios.get(`${this.NATIONALIZE_URL}?name=${encodeURIComponent(name)}`),
      ]);
    } catch (error: any) {
      // Determine which API failed based on the URL
      const url = error?.config?.url || '';
      let apiName = 'Unknown';
      if (url.includes('genderize')) apiName = 'Genderize';
      else if (url.includes('agify')) apiName = 'Agify';
      else if (url.includes('nationalize')) apiName = 'Nationalize';

      throw { status: 502, externalApi: apiName };
    }

    // Genderize validation
    const genderData = genderRes.data;
    if (genderData.gender === null || genderData.gender === undefined || genderData.count === 0) {
      throw { status: 502, externalApi: 'Genderize' };
    }

    // Agify validation
    const ageData = ageRes.data;
    if (ageData.age === null || ageData.age === undefined) {
      throw { status: 502, externalApi: 'Agify' };
    }

    // Nationalize validation
    const nationData = nationRes.data;
    if (!nationData.country || !Array.isArray(nationData.country) || nationData.country.length === 0) {
      throw { status: 502, externalApi: 'Nationalize' };
    }

    // Pick country with highest probability
    const bestCountry = nationData.country.reduce((prev: any, current: any) =>
      (prev.probability > current.probability) ? prev : current
    );

    return {
      gender: genderData.gender,
      gender_probability: genderData.probability,
      sample_size: genderData.count,
      age: ageData.age,
      age_group: this.classifyAgeGroup(ageData.age),
      country_id: bestCountry.country_id,
      country_probability: bestCountry.probability,
    };
  }

  private static classifyAgeGroup(age: number): string {
    if (age >= 0 && age <= 12) return 'child';
    if (age >= 13 && age <= 19) return 'teenager';
    if (age >= 20 && age <= 59) return 'adult';
    return 'senior';
  }
}
