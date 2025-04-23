const express = require('express');
const axios = require('axios');
const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');
const app = express();

app.use(express.json());

// Function to download file from URL
async function downloadFile(url, filePath) {
  const response = await axios({
    url,
    method: 'GET',
    responseType: 'arraybuffer',
  });
  
  fs.writeFileSync(filePath, response.data);
  return filePath;
}

// Function to read specific sheets from Excel file
function readExcelSheets(filePath, sheetNames) {
  const workbook = xlsx.readFile(filePath);
  const result = {};
  
  sheetNames.forEach(sheetName => {
    if (workbook.SheetNames.includes(sheetName)) {
      const worksheet = workbook.Sheets[sheetName];
      result[sheetName] = xlsx.utils.sheet_to_json(worksheet);
    } else {
      console.warn(`Sheet "${sheetName}" not found in Excel file`);
      result[sheetName] = null;
    }
  });
  
  return result;
}

// Main API endpoint
app.post('/api/financial-data', async (req, res) => {
  try {
    // Extract required parameters from request body
    const { entityId, financialYear } = req.body;
    
    if (!entityId || !financialYear || !Array.isArray(financialYear)) {
      return res.status(400).json({ 
        error: 'Invalid request parameters. Required: entityId, financialYear (array)' 
      });
    }
    
    // Call Karza Financial Summary API
    const karzaResponse = await axios.post(
      'https://api.karza.in/kscan/test/v3/corp/docs/financialSummary',
      {
        consent: "Y",
        entityId: entityId,
        financialYear: financialYear,
        financialType: "both"
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-karza-key': 'EuwDokaowj5hrq4P51FK'  
        }
      }
    );
    
    // Check if consolidated data exists
    if (!karzaResponse.data.result.consolidated || 
        karzaResponse.data.result.consolidated.length === 0 ||
        !karzaResponse.data.result.consolidated[0].metadata.excelLink) {
      return res.status(404).json({ error: 'Excel link not found in consolidated data' });
    }
    
    // Extract Excel link from response
    const excelLink = karzaResponse.data.result.consolidated[0].metadata.excelLink;
    
    // Create temp directory if it doesn't exist
    const tempDir = path.join(__dirname, 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir);
    }
    
    // Generate unique filename for downloaded Excel
    const fileName = `financial_data_${Date.now()}.xlsx`;
    const filePath = path.join(tempDir, fileName);
    
    // Download Excel file
    await downloadFile(excelLink, filePath);
    
    // Read required sheets from Excel file
    const sheetsToRead = ['BALANCE SHEET', 'CASH FLOW STATEMENT', 'PROFIT AND LOSS', 'financialSummary'];
    const excelData = readExcelSheets(filePath, sheetsToRead);
    

    const sheetNameMapping = {
        'BALANCE SHEET': 'balanceSheet',
        'CASH FLOW STATEMENT': 'cashFlowStatement',
        'PROFIT AND LOSS': 'profitAndLoss',
        'financialSummary': 'financialSummary'
      };
  
      const mappedExcelData = {};
      for (const originalName in excelData) {
        const mappedKey = sheetNameMapping[originalName] || originalName;
        mappedExcelData[mappedKey] = excelData[originalName];
      }

    // Clean up - remove the downloaded file
    fs.unlinkSync(filePath);
    
    // Return the data from Excel sheets
    res.json({
      entityId,
      financialYear,
      financial_summary_data: mappedExcelData
    });
    
  } catch (error) {
    console.error('Error processing request:', error);
    res.status(500).json({ 
      error: 'Failed to process request',
      details: error.message
    });
  }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});