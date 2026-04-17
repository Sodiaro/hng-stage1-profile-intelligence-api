import axios from 'axios';

const BASE_URL = 'http://localhost:3000/api/profiles';

async function runTests() {
  console.log('--- Starting API Tests ---');

  try {
    // 1. Create a profile (POST /api/profiles)
    console.log('\n1. Testing POST /api/profiles (New Name: "ella")');
    const postRes = await axios.post(BASE_URL, { name: 'ella' });
    console.log('Response Status:', postRes.status);
    console.log('Response Body:', JSON.stringify(postRes.data, null, 2));
    const profileId = postRes.data.data.id;

    // 2. Test Idempotency (POST /api/profiles again)
    console.log('\n2. Testing Idempotency (Same Name: "ella")');
    const postResDup = await axios.post(BASE_URL, { name: 'ella' });
    console.log('Response Status:', postResDup.status);
    console.log('Response Message:', postResDup.data.message);

    // 3. Get profile by ID (GET /api/profiles/:id)
    console.log(`\n3. Testing GET /api/profiles/${profileId}`);
    const getRes = await axios.get(`${BASE_URL}/${profileId}`);
    console.log('Response Status:', getRes.status);
    console.log('Response Name:', getRes.data.data.name);

    // 4. List profiles with filters (GET /api/profiles)
    console.log('\n4. Testing GET /api/profiles (Filter: gender=female)');
    const listRes = await axios.get(`${BASE_URL}?gender=female`);
    console.log('Response Status:', listRes.status);
    console.log('Count:', listRes.data.count);
    console.log('First Profile Name:', listRes.data.data[0]?.name);

    // 5. Delete profile (DELETE /api/profiles/:id)
    console.log(`\n5. Testing DELETE /api/profiles/${profileId}`);
    const delRes = await axios.delete(`${BASE_URL}/${profileId}`);
    console.log('Response Status:', delRes.status);

    // 6. Verify Deletion (GET /api/profiles/:id should be 404)
    console.log('\n6. Verifying Deletion (GET should be 404)');
    try {
      await axios.get(`${BASE_URL}/${profileId}`);
    } catch (error: any) {
      console.log('Response Status:', error.response.status);
      console.log('Error Message:', error.response.data.message);
    }

    // 7. Test Bad Requests
    console.log('\n7. Testing Bad Request (Missing Name)');
    try {
      await axios.post(BASE_URL, {});
    } catch (error: any) {
      console.log('Response Status:', error.response.status);
      console.log('Error Message:', error.response.data.message);
    }

    console.log('\n--- Tests Completed ---');
  } catch (error: any) {
    console.error('Test Failed:', error.response?.data || error.message);
  }
}

runTests();
