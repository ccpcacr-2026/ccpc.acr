function doGet(e) {
  const sheet = SpreadsheetApp.openById("11l3oc1mpbR8UerpDxCatzuhcBNqkbdNzWzOTiPPdKgk").getSheetByName("Selected");
  const rowDataSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Classes");
  const rowData = rowDataSheet.getDataRange().getValues();
  const action = e.parameter.action;


  Logger.log("value got from kodular: "+JSON.stringify(e));  
 if (action == "write") {
    sheet.getRange("P1").setValue("Updating...");
    const t_To = e.parameter.sto;
    const  row1  = e.parameter.row1;
    const col = e.parameter.col;
    const range = sheet.getRange(row1,col);
    const oldValue = range.getValue();
    processSelectedSheet(sheet,oldValue,range,t_To);
    sheet.getRange("P1").setValue("");
    return ContentService.createTextOutput("Class adjusted successfully.");

    
  }
  else if(action == "setup"){
    const newDate = e.parameter.date;
    SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Selected").getRange("D1").setValue(Utilities.formatDate(new Date(newDate), Session.getScriptTimeZone(),"MMM dd,yyyy"));
    copyValuesBasedOnCondition()
    return ContentService.createTextOutput("Data has been Processed successfully.");
  }
   else if(action == "pdf"){
    var fileURL = "https://docs.google.com/gview?embedded=true&url=https://drive.google.com/uc?id="+generateCut_TomPDF();
        return ContentService.createTextOutput(fileURL);
  }
  else {
    return ContentService.createTextOutput("No valid action specified.");
  }


}
function generateCut_TomPDF() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var selectedsheet = spreadsheet.getSheetByName("Selected");
  var check =selectedsheet.getRange("P1");
  for (let i=0;i<35;i++){
    if(check.getValue()==="" || check.getValue()=== null) break;
   
    else {
      Logger.log("Another work is running");
      Utilities.sleep(1000);
    }
  }
  var sheet = spreadsheet.getSheetByName("Adjustment"); // Access the 'Adjustment' sheet
  var sheet_gid = "2071945449"; // The gid for the sheet
  var folderId = '1oecmsm69c-sy6U_Zkg-h-lpxpOl3hMbg'; // Folder ID where PDF will be saved
  var folder = DriveApp.getFolderById(folderId); // Get the folder by ID

  var url = "https://docs.google.com/spreadsheets/d/" + spreadsheet.getId() + "/export?";

  // Format the current date and time as "20 Feb, 2025; 4:20pm"
  var adj_Date = new Date(selectedsheet.getRange("D1").getValue());
  var now = new Date();

  var options = { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: 'numeric', hour12: true };
  var formattedDate = adj_Date.toLocaleString('en-US', options).replace(',', '').replace('AM', 'am').replace('PM', 'pm').substring(0, 16)+"(PDF Created: "+now.toLocaleString('en-US', options).replace(',', '').replace('AM', 'am').replace('PM', 'pm').slice(4)+")";
  
  var fileName = formattedDate + ".pdf"; // Name file as "20 Feb, 2025; 4:20pm.pdf"

  // Export options
  var rowCount = sheet.getLastRow();
  var exportOptions = {
    "format": "pdf",
    "size": "A4",
    "portrait": true,
    "fitw": true,
    "gridlines": false,
    "top_margin": 0.5,
    "bottom_margin": 0.5,
    "left_margin": 0.5,
    "right_margin": 0.5,
    "horizontal_align": "CENTER",
    "vertical_align": "MIDDLE",
    "gid": sheet_gid,
    "sheetnames": true,
    "printtitle": false
  };
  if (rowCount > 50) exportOptions["scale"] = 2;

  // Construct export URL
  var exportUrl = url + Object.keys(exportOptions).map(function(key) {
    return key + "=" + encodeURIComponent(exportOptions[key]);
  }).join("&");

  try {
    // Fetch the PDF file as a blob
    var response = UrlFetchApp.fetch(exportUrl, {
      "method": "get",
      "headers": {
        "Authorization": "Bearer " + ScriptApp.getOAuthToken()
      }
    });
    var pdfBlob = response.getBlob().setName(fileName);
    
    // Check if a file with the same name exists and delete it
    var files = folder.getFilesByName(fileName);
    while (files.hasNext()) {
      var existingFile = files.next();
      existingFile.setTrashed(true); // Move to trash
    }

    // Save the new PDF to Google Drive folder
    var file = folder.createFile(pdfBlob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    var fileUrl = file.getUrl();
    var fileId = file.getId();

    // Access or create the "Adjustment link" sheet
    var linkSheet = spreadsheet.getSheetByName("Adjustment link");
    if (!linkSheet) {
      linkSheet = spreadsheet.insertSheet("Adjustment link");
      linkSheet.appendRow(["PDF Name", "Download Link"]);
    }
    
    // Check if a row with the same file name exists and replace it
    var data = linkSheet.getDataRange().getValues();
    var datePortion = fileName.substring(0, 16);
    var replaced = false;
    var serial =1;
    for (var i = 1; i < data.length; i++) {
      if (data[i][0].includes(datePortion)) {
        linkSheet.getRange(i + 1, 1).setValue(fileName); // Replace the URL
        linkSheet.getRange(i + 1, 2).setValue(fileUrl); // Replace the URL
        var status = linkSheet.getRange(i + 1, 3).getValue();
        if(status && status!=="" && status!== null){
          serial =Math.abs(status.slice(7))+1;
        }
       
        linkSheet.getRange(i+1,3).setValue("Update "+serial);
        replaced = true;
        break;
      }
    }
    
    // If no existing row is found, append a new one
    if (!replaced) {
      linkSheet.insertRowsBefore(2, 1);
      linkSheet.getRange("A2:B2").setValues([[fileName, fileUrl]]);
    }
    
    Logger.log("Download PDF: " + fileUrl);
    return fileId;
  } catch (error) {
    Logger.log("Error: " + error.toString());
  }
}
function setFooter() {
  var spreadsheetId = SpreadsheetApp.getActiveSpreadsheet().getId();
  var sheetId = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Adjustment").getSheetId();
  
  var requests = [{
    "updateSheetProperties": {
      "properties": {
        "sheetId": sheetId,
        "footer": {
          "left": "Software Generated Adjustment PDF"
        }
      },
      "fields": "footer"
    }
  }];
  
  Sheets.Spreadsheets.batchUpdate({'requests': requests}, spreadsheetId);
}