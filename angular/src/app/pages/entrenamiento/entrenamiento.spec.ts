import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Entrenamiento } from './entrenamiento';

describe('Entrenamiento', () => {
  let component: Entrenamiento;
  let fixture: ComponentFixture<Entrenamiento>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Entrenamiento]
    })
    .compileComponents();

    fixture = TestBed.createComponent(Entrenamiento);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
