import { Module } from '@nestjs/common';
import { GoogleDriveService } from './googleDrive.service';
import { GoogleAuthService } from './googleAuth.service';
import { FilesystemModule } from '../filesystem/filesystem.module';

@Module({
  providers: [GoogleAuthService, GoogleDriveService],
  exports: [GoogleDriveService],
  imports: [FilesystemModule],
})
export class GoogleApiModule {}
